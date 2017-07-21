'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var utils = require('../../utils');
var _ = require('lodash');
var LRU = require('lru-cache');
var Unit = require('bitcore-lib').Unit;

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

// --- start private prototype functions
TransactionService.prototype._cacheOutputValues = function(tx) {

  var values = tx.outputs.map(function(output) {
    return Unit.fromBTC(output.value).toSatoshis();
  });

  this._inputValuesCache.set(tx.txid(), values);

};

TransactionService.prototype._getBlockTimestamp = function(hash) {
  return this._timestamp.getTimestampSync(hash);
};

TransactionService.prototype._getInputValues = function(tx) {

  var self = this;

  return tx.inputs.map(function(input) {
    var value = self._inputValuesCache.get(input.prevout.txid());
    if (value) {
      return value[input.prevout.index];
    }
    return null;
  });
};

TransactionService.prototype._onBlock = function(block) {

  var self = this;

  var operations = block.txs.map(function(tx) {
    return self._processTransaction(tx, { block: block });
  });

  if (operations && operations.length > 0) {

    self._db.batch(operations);

  }

};

TransactionService.prototype._onReorg = function(oldBlockList, commonAncestor) {

  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (this._tip.height <= commonAncestor.header.height) {
    return;
  }

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ hash: commonAncestor.hash, height: commonAncestor.header.height }, this.name);

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  for(var i = 0; i < oldBlockList.length; i++) {
    var block = oldBlockList[i];
    for(var j = 0; j < block.transactions.length; j++) {
      var tx = block.transactions[j];
      removalOps.push({
        type: 'del',
        key: this._encoding.encodeTransactionKey(tx.id)
      });
    }
  }

  this._db.batch(removalOps);

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
  tx.__timestamp = this._getBlockTimestamp(opts.block.rhash());
  //height
  tx.__height = opts.block.height;

  return {
    key: this._encoding.encodeTransactionKey(tx.txid()),
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

  this._bus.on('block/block', this._onBlock.bind(this));
  this._bus.on('block/reorg', this._onReorg.bind(this));

  this._bus.subscribe('block/block');
  this._bus.subscribe('block/reorg');
};

module.exports = TransactionService;
