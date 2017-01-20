'use strict';

var async = require('async');
var BaseService = require('../service');
var inherits = require('util').inherits;
var bitcore = require('bitcore-lib');

function TransactionService(options) {
  BaseService.call(this, options);
  this.concurrency = options.concurrency || 20;
  this.currentTransactions = {};
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'db',
  'timestamp'
];

TransactionService.prototype.start = function(callback) {
  var self = this;

  this.store = this.node.services.db.store;

  this.node.services.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }

    self.prefix = prefix;

    callback();
  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TransactionService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;
  var action = 'put';
  if (!connectBlock) {
    action = 'del';
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
            key: self._encodeTransactionKey(tx.id),
            value: self._encodeTransactionValue(tx)
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

TransactionService.prototype._getInputValues = function(tx, callback) {
  var self = this;

  if (tx.isCoinbase()) {
    return callback(null, []);
  }

  async.mapLimit(tx.inputs, this.concurrency, function(input, next) {
    self.getTransaction(input.prevTxId.toString('hex'), function(err, prevTx) {
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

TransactionService.prototype.getTransaction = function(txid, callback) {
  var self = this;

  if(self.currentTransactions[txid]) {
    return setImmediate(function() {
      callback(null, self.currentTransactions[txid]);
    });
  }

  var key = self._encodeTransactionKey(txid);

  self.node.services.db.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    var tx = self._decodeTransactionValue(buffer);
    callback(null, tx);
  });
};

TransactionService.prototype._encodeTransactionKey = function(txid) {
  return Buffer.concat([this.prefix, new Buffer(txid, 'hex')]);
};

TransactionService.prototype._decodeTransactionKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

TransactionService.prototype._encodeTransactionValue = function(transaction) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(transaction.__height);

  var timestampBuffer = new Buffer(8);
  timestampBuffer.writeDoubleBE(transaction.__timestamp);

  var inputValues = transaction.__inputValues;
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }

  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length * 8);

  return new Buffer.concat([heightBuffer, timestampBuffer, inputValuesLengthBuffer, inputValuesBuffer, transaction.toBuffer()]);
};

TransactionService.prototype._decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();

  var timestamp = buffer.readDoubleBE(4);

  var inputValues = [];
  var inputValuesLength = buffer.readUInt16BE(12);
  for(var i = 0; i < inputValuesLength / 8; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 14));
  }
  var transaction = new bitcore.Transaction(buffer.slice(inputValues.length * 8 + 14));
  transaction.__height = height;
  transaction.__inputValues = inputValues;
  transaction.__timestamp = timestamp;
  return transaction;
};

module.exports = TransactionService;
