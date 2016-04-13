'use strict';

var async = require('async');
var bitcore = require('bitcore-lib');
var Transaction = bitcore.Transaction;

var MAX_TRANSACTION_LIMIT = 5;

Transaction.prototype.populateSpentInfo = function(db, options, callback) {
  var self = this;
  var txid = self.hash;

  async.eachLimit(
    Object.keys(self.outputs),
    db.maxTransactionlimit || MAX_TRANSACTION_LIMIT,
    function(outputIndex, next) {
      db.getSpentInfo({
        txid: txid,
        index: parseInt(outputIndex)
      }, function(err, info) {
        if (err) {
          return next(err);
        }
        self.outputs[outputIndex].__spentTxId = info.txid;
        self.outputs[outputIndex].__spentIndex = info.index;
        self.outputs[outputIndex].__spentHeight = info.height;
        next();
      });
    },
    callback
  );
};

Transaction.prototype.populateInputs = function(db, poolTransactions, callback) {
  var self = this;

  if(this.isCoinbase()) {
    return setImmediate(callback);
  }

  async.eachLimit(
    this.inputs,
    db.maxTransactionLimit || MAX_TRANSACTION_LIMIT,
    function(input, next) {
      self._populateInput(db, input, poolTransactions, next);
    },
    callback
  );
};

Transaction.prototype._populateInput = function(db, input, poolTransactions, callback) {
  if (!input.prevTxId || !Buffer.isBuffer(input.prevTxId)) {
    return callback(new TypeError('Input is expected to have prevTxId as a buffer'));
  }
  var txid = input.prevTxId.toString('hex');
  db.getTransaction(txid, function(err, prevTx) {
    if(err) {
      return callback(err);
    } else if (!prevTx) {
      // Check the pool for transaction
      for(var i = 0; i < poolTransactions.length; i++) {
        if(txid === poolTransactions[i].hash) {
          input.output = poolTransactions[i].outputs[input.outputIndex];
          return callback();
        }
      }
      return callback(new Error('Previous tx ' + input.prevTxId.toString('hex') + ' not found'));
    }
    input.output = prevTx.outputs[input.outputIndex];
    callback();
  });
};

module.exports = Transaction;
