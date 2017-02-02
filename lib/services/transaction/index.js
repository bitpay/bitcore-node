'use strict';

var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');

/**
 * The Transaction Service builds upon the Database Service and the Bitcoin Service to add additional
 * functionality for getting information by bitcoin transaction hash/id. This includes the current
 * bitcoin memory pool as validated by a trusted bitcoind instance.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 */
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

  self.store = this.node.services.db.store;

  self.node.services.db.getPrefix(self.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    callback();
  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TransactionService.prototype.blockHandler = function(block, connectBlock, callback) {
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
        return next(new Error('Input did not have utxo.'));
      }
      var satoshis = prevTx.outputs[input.outputIndex].satoshis;
      next(null, satoshis);
    });
  }, callback);
};

TransactionService.prototype.getTransaction = function(txid, options, callback) {
  var self = this;

  if(self.currentTransactions[txid]) {
    return setImmediate(function() {
      callback(null, self.currentTransactions[txid]);
    });
  }

  var key = self.encoding.encodeTransactionKey(txid);

  async.waterfall([
    function(next) {
      self.node.services.db.store.get(key, function(err, buffer) {
        if(err) {
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
        return next();
      }
      self.node.services.mempool.getTransaction(txid, function(err, tx) {
          if(err) {
            return next(err);
          }
          if (!tx) {
            return next();
          }
          self._getMissingInputValues(tx, next);
      });
    }], callback);
};


module.exports = TransactionService;
