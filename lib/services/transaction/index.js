'use strict';

var assert = require('assert');
var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var levelup = require('levelup');

function TransactionService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this.currentTransactions = {};
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'db',
  'block',
  'timestamp',
  'mempool'
];

TransactionService.prototype.getAPIMethods = function() {
  return [
    ['getRawTransaction', this, this.getRawTransaction, 1],
    ['getTransaction', this, this.getTransaction, 1],
    ['getDetailedTransaction', this, this.getDetailedTransaction, 1],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['getSpentInfo', this, this.getSpentInfo, 1],
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};

TransactionService.prototype.getSpentInfo = function(txid, callback) {
};

TransactionService.prototype.getRawTransaction = function(txid, callback) {
  this.getTransaction(txid, function(err, tx) {
    if (err) {
      return callback(err);
    }
    return tx.serialize();
  });
};

TransactionService.prototype.getDetailedTransaction = TransactionService.prototype.getTransaction = function(txid, options, callback) {

  var self = this;

  var key = self.encoding.encodeTransactionKey(txid);

  async.waterfall([
    function(next) {
      self.node.services.db.get(key, function(err, buffer) {
        if (err instanceof levelup.errors.NotFoundError) {
          return next(null, false);
        } else if (err) {
          return callback(err);
        }
        var tx = self.encoding.decodeTransactionValue(buffer);
        next(null, tx);
      });
    }, function(tx, next) {
      if (tx) {
        return next(null, tx);
      }
      if (!options || !options.queryMempool) {
        return next(new Error('Transaction: ' + txid + ' not found in index'));
      }
      self.node.services.mempool.getTransaction(txid, function(err, tx) {
        if (err instanceof levelup.errors.NotFoundError) {
          return callback(new Error('Transaction: ' + txid + ' not found in index or mempool'));
        } else if (err) {
          return callback(err);
        }
        self._getMissingInputValues(tx, next);
      });
    }], callback);
};

TransactionService.prototype.onBlock = function(block, connectBlock, callback) {
  var self = this;
  var action = 'put';
  var reverseAction = 'del';
  if (!connectBlock) {
    action = 'del';
    reverseAction = 'put';
  }

  var operations = [];

  this.currentTransactions = {};

  async.series([
    function(next) {
      self.node.services.timestamp.getTimestamp(block.hash, function(err, timestamp) {
        if(err) {
          return next(err);
        }
        block.__timestamp = timestamp;
        next();
      });
    }, function(next) {
      async.eachSeries(block.transactions, function(tx, next) {
        tx.__timestamp = block.__timestamp;
        tx.__height = block.__height;

        self._getInputValues(tx, function(err, inputValues) {
          if(err) {
            return next(err);
          }
          tx.__inputValues = inputValues;
          self.currentTransactions[tx.id] = tx;

          operations.push({
            type: action,
            key: self.encoding.encodeTransactionKey(tx.id),
            value: self.encoding.encodeTransactionValue(tx)
          });
          next();
        });
      }, function(err) {
        if(err) {
          return next(err);
        }
        next();
      });
    }], function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, operations);
    });

};

TransactionService.prototype.sendTransaction = function(tx, callback) {
  this._p2p.sendTransaction(tx, callback);
};

TransactionService.prototype._setListeners = function() {

  var self = this;

  self._db.on('error', self._onDbError.bind(self));
  self.on('reorg', self._onReorg.bind(self));

};

TransactionService.prototype._onDbError = function(error) {
};

TransactionService.prototype._onReorg = function(commonAncestor, newBlockList) {
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
      self.encoding = new Encoding(self.prefix);
      self._startSubscriptions();
      callback();

    });
  });
};

TransactionService.prototype._onTransaction = function(transaction) {
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

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TransactionService.prototype.syncPercentage = function(callback) {

};

TransactionService.prototype._getMissingInputValues = function(tx, callback) {

  var self = this;

  if (tx.isCoinbase()) {
    return callback(null, []);
  }

  async.eachOf(tx.inputs, function(input, index, next) {
    if (tx.__inputValues[index]) {
      return next();
    }
    self.getTransaction(input.prevTxId.toString('hex'), {}, function(err, prevTx) {
      if(err) {
        return next(err);
      }
      if (!prevTx) {
        return next(new Error('previous Tx missing.'));
      }
      if (!prevTx.outputs[input.outputIndex]) {
        return next(new Error('Input did not have utxo.'));
      }
      var satoshis = prevTx.outputs[input.outputIndex].satoshis;
      tx.__inputValues[index] = satoshis;
      next();
    });
  }, callback);

};

TransactionService.prototype._getInputValues = function(tx, callback) {
  var self = this;

  if (tx.isCoinbase()) {
    return callback(null, []);
  }

  async.mapLimit(tx.inputs, this.concurrency, function(input, next) {
    self.getTransaction(input.prevTxId.toString('hex'), {}, function(err, prevTx) {
      if(err) {
        return next(err);
      }
      if (!prevTx.outputs[input.outputIndex]) {
        return next(new Error('Input did not have utxo: ' + prevTx.id + ' for tx: ' + tx.id));
      }
      var satoshis = prevTx.outputs[input.outputIndex].satoshis;
      next(null, satoshis);
    });
  }, callback);
};

module.exports = TransactionService;
