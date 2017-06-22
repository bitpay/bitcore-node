'use strict';

var assert = require('assert');
var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var levelup = require('levelup');

function TransactionService(options) {
  BaseService.call(this, options);
  this.concurrency = options.concurrency || 20;
  this.currentTransactions = {};
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'db',
  'timestamp',
  'mempool'
];

TransactionService.prototype.start = function(callback) {
  var self = this;

  self.db = this.node.services.db;

  self.db.getPrefix(self.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    self._setListeners();
    callback();
  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};


TransactionService.prototype._setListeners = function() {
  this._startSubscriptions();
};

TransactionService.prototype._startSubscriptions = function() {
  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self.bus = self.node.openBus({remoteAddress: 'localhost'});

  self.bus.on('block/block', self._onBlock.bind(self));
  self.bus.subscribe('block/block');

};

TransactionService.prototype._onBlock = function(block) {
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

TransactionService.prototype.getTransaction = function(txid, options, callback) {
  var self = this;

  assert(txid.length === 64, 'Transaction, Txid: ' +
    txid + ' with length: ' + txid.length + ' does not resemble a txid.');

  if(self.currentTransactions[txid]) {
    return setImmediate(function() {
      callback(null, self.currentTransactions[txid]);
    });
  }

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


module.exports = TransactionService;
