'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var utils = require('../../utils');
var _ = require('lodash');
var Unit = require('bitcore-lib').Unit;
var log = require('../../index').log;
var async = require('async');
var assert = require('assert');

function TransactionService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._mempool = this.node.services.mempool;
  this._block = this.node.services.block;
  this._header = this.node.services.header;
  this._p2p = this.node.services.p2p;
  this._timestamp = this.node.services.timestamp;
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
    ['getInputValues', this, this._getInputValues, 1]
  ];
};

TransactionService.prototype.getDetailedTransaction = function(txid, options, callback) {
  this.getTransaction(txid, options, callback);
};

TransactionService.prototype.getTransaction = function(txid, options, callback) {

  var self = this;

  if (typeof callback !== 'function') {
    callback = options;
  }

  self._getTransaction(txid, options, function(err, tx) {

    if (err) {
      return callback(err);
    }

    if (!tx) {
      return callback();
    }

    self._addMissingInputValues(tx, options, callback);

  });

};

TransactionService.prototype._getTransaction = function(txid, options, callback) {

  var self = this;

  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;

  var key = self._encoding.encodeTransactionKey(txid);

  async.waterfall([
    // main index?
    function(next) {
      self._db.get(key, function(err, tx) {

        if (err) {
          return next(err);
        }

        if (!tx) {
          return next(null, tx);
        }

        tx = self._encoding.decodeTransactionValue(tx);
        tx.confirmations = self._header.getBestHeight() - tx.__height;

        self._header.getBlockHeader(tx.__height, function(err, header) {

          if (err) {
            return next(err);
          }

          if (header) {
            tx.blockHash = header.hash;
          }

          next(null, tx);

        });
      });
    },
    // mempool?
    function(tx, next) {

      if (queryMempool && !tx) {

        return self._mempool.getMempoolTransaction(txid, function(err, memTx) {

          if (err) {
            return next(err);
          }

          if (memTx) {
            memTx = self._encoding.decodeTransactionValue(memTx);
            memTx.confirmations = 0;
          }

          next(null, memTx);
        });

      }

      next(null, tx);

    }
  ], function(err, tx) {

    if (err) {
      return callback(err);
    }

    if (!tx) {
      return callback();
    }

    // output values
    var outputSatoshis = 0;

    tx.outputs.forEach(function(output) {
      outputSatoshis += output.value;
    });

    tx.outputSatoshis = outputSatoshis;


    //input values
    if (!tx.inputs[0].isCoinbase()) {

      var inputSatoshis = 0;

      tx.__inputValues.forEach(function(val) {

        if (val >- 0) {
          inputSatoshis += val;
        }
      });

      var feeSatoshis = inputSatoshis - outputSatoshis;
      tx.inputSatosbis = inputSatoshis;
      tx.feeSatosbis = feeSatoshis;

    }

    callback(null, tx);

  });

};

TransactionService.prototype._addMissingInputValues = function(tx, options, callback) {

  // if we have cache misses from when we populated input values,
  // then we must go and find them after the fact (lazy-load).
  var self = this;
  async.eachOfLimit(tx.inputs, 4, function(input, index, next) {

    var inputSatoshis = tx.__inputValues[index];

    if (inputSatoshis >= 0 || input.isCoinbase()) {
      return next();
    }

    var outputIndex = input.prevout.index;

    self._getTransaction(input.prevout.txid(), options, function(err, _tx) {

      if (err || !_tx) {
        return next(err || new Error('tx not found for tx id: ' + input.prevout.txid()));
      }

      var output = _tx.outputs[outputIndex];
      assert(output, 'Expected an output, but did not get one for tx: ' + _tx.txid() + ' outputIndex: ' + outputIndex);
      tx.__inputValues[index] = Unit.fromBTC(output.value).toSatoshis();
      next();

    });

  }, function(err) {

    if (err) {
      return callback(err);
    }

    var key = self._encoding.encodeTransactionKey(tx.txid());
    var value = self._encoding.encodeTransactionValue(tx);

    self._db.put(key, value, function(err) {

      if (err) {
        return callback(err);
      }

      callback(null, tx);

    });

  });
};

TransactionService.prototype.sendTransaction = function(tx, callback) {
  this._p2p.sendTransaction(tx, callback);
};

TransactionService.prototype.start = function(callback) {

  var self = this;

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
TransactionService.prototype._getBlockTimestamp = function(hash) {
  return this._timestamp.getTimestampSync(hash);
};

TransactionService.prototype.onBlock = function(block, callback) {

  var self = this;

  if (self.node.stopping) {
    return callback();
  }

  var operations = block.txs.map(function(tx) {
    return self._processTransaction(tx, { block: block });
  });

  callback(null, operations);

};

TransactionService.prototype._onReorg = function(commonAncestorHeader, oldBlockList) {

  var self = this;
  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (self._tip.height <= commonAncestorHeader.height) {
    return;
  }

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ hash: commonAncestorHeader.hash, height: commonAncestorHeader.height }, self.name);

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
        key: self._encoding.encodeTransactionKey(tx.id)
      });
    }
  }

  self._db.batch(removalOps, function(err) {
    if (err) {
      log.error('Transaction Service: error removing operations during reorg.' + err);
      self.node.stop();
      return;
    }
  });

};

TransactionService.prototype._processTransaction = function(tx, opts) {

  // this index is very simple txid -> tx, but we also need to find each
  // input's prev output value, the adjusted timestamp for the block and
  // the tx's block height

  // input values
  tx.__inputValues = []; // these are lazy-loaded on the first access of the tx

  // timestamp
  tx.__timestamp = this._getBlockTimestamp(opts.block.rhash());
  assert(tx.__timestamp, 'Timestamp is required when saving a transaction.');

  // height
  tx.__height = opts.block.height;
  assert(tx.__height, 'Block height is required when saving a trasnaction.');

  return {
    key: this._encoding.encodeTransactionKey(tx.txid()),
    value: this._encoding.encodeTransactionValue(tx)
  };

};

TransactionService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('block/reorg', this._onReorg.bind(this));
  this._bus.subscribe('block/reorg');
};

module.exports = TransactionService;
