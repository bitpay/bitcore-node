'use strict';

var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var utils = require('../../lib/utils');
var _ = require('lodash');
var LRU = require('lru-cache');

function TransactionService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._mempool = this.node.services._mempool;
  this._block = this.node.services.block;
  this._p2p = this.node.services.p2p;
  this._timestamp = this.node.services.timestamp;
  this._inputValuesCache = LRU(1E6); // this should speed up syncing
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'p2p',
  'db',
  'block',
  'timestamp',
  'mempool'
];

// ---- start public function protorypes
TransactionService.prototype.getAPIMethods = function() {
  return [
    ['getRawTransaction', this, this.getRawTransaction, 1],
    ['getTransaction', this, this.getTransaction, 1],
    ['getDetailedTransaction', this, this.getDetailedTransaction, 1],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['syncPercentage', this, this.syncPercentage, 0],
    ['getInputValues', this, this._getInputValues, 1]
  ];
};

TransactionService.prototype.getDetailedTransaction = function(txid, options, callback) {
  this.getTransaction(txid, options, callback);
};

TransactionService.prototype.getTransaction = function(txid, options, callback) {

  var self = this;

  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;

  var key = self.encoding.encodeTransactionKey(txid);
  this._db.get(key, function(err, tx) {

    if(err) {
      return callback(err);
    }

    if (queryMempool && !tx) {

      this._mempool.getTransaction(tx, function(err, memTx) {

        if(err) {
          return callback(err);
        }

        if (memTx) {
          memTx.confirmations = 0;
          return callback(null, memTx);
        }
        return callback();

      });

    } else {

      if (tx) {
        tx.confirmations = this._p2p.getBestHeight - tx.__height;
        return callback(null,  tx);
      }
      return callback();

    }

  });

};

TransactionService.prototype.sendTransaction = function(tx, callback) {
  this._p2p.sendTransaction(tx, callback);
};

TransactionService.prototype.start = function(callback) {

  var self = this;
  self._setListeners();

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self._db.getServiceTip(self.name, function(err, tip) {

      if (err) {
        return callback(err);
      }

      self._tip = tip;
      self.prefix = prefix;
      self._encoding = new Encoding(self.prefix);
      self._startSubscriptions();
      callback();

    });
  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TransactionService.prototype.syncPercentage = function(callback) {

};

// --- start private prototype functions
TransactionService.prototype._cacheOutputValues = function(tx) {

  var values = tx.outputs.map(function(output) {
    return output.satoshis;
  });

  this._inputValuesCache.set(tx.id, values);

};

TransactionService.prototype._getBlockTimestamp = function(hash) {
  return this._timestamp.getTimestamp(hash);
};

TransactionService.prototype._getInputValues = function(tx) {

  return tx.inputs.map(function(input) {
    var value = this._inputValuesCache.get(input.prevTxId);
    if (value) {
      return value[input.outputIndex];
    }
    return null;
  });
};

TransactionService.prototype._onBlock = function(block) {

  var self = this;

  var operations = block.transactions.map(function(tx) {
    return self._processTransaction(tx, { block: block });
  });

  if (operations && operations.length > 0) {

    self._db.batch(operations);

  }

};

TransactionService.prototype._onReorg = function(oldBlockList, newBlockList, commonAncestor) {

  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (this._tip.height <= commonAncestor.header.height) {
    return;
  }

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ hash: commonAncestor.hash, height: commonAncestor.header.height });

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.concat([
      {
        type: 'del',
        key: this.encoding.encodeAddressIndexKey(),
      },
      {
        type: 'del',
        key: this.encoding.encodeBlockTimestampKey(block.hash),
      }
    ]);
  });

  this._db.batch(removalOps);

  //call onBlock for each of the new blocks
  newBlockList.forEach(this._onBlock.bind(this));
};

TransactionService.prototype._processTransaction = function(tx, opts) {

  // squirrel away he current outputs
  this._cacheOutputValues(tx);

  // this index is very simple txid -> tx, but we also need to find each
  // input's prev output value, the adjusted timestamp for the block and
  // the tx's block height

  // input values
  tx.__inputValues = this._getInputValues(tx); //if there are any nulls here, this is a cache miss
  //timestamp
  tx.__timestamp = this._getBlockTimestamp(opts.block);
  //height
  tx.__height = opts.block.height;

  return {
    key: this._encoding.encodeTransactionKey(tx.id),
    value: this._encoding.encodeTransactionValue(tx)
  };

};

TransactionService.prototype._setListeners = function() {

  var self = this;

  self.on('reorg', self._onReorg.bind(self));

};

TransactionService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('block/block', this._onTransaction.bind(this));
  this._bus.subscribe('block/block');
};

module.exports = TransactionService;
