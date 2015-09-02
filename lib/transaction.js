'use strict';

var async = require('async');
var levelup = require('levelup');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;

Transaction.prototype.populateInputs = function(db, poolTransactions, callback) {
  var self = this;

  if(this.isCoinbase()) {
    return setImmediate(callback);
  }

  async.each(
    this.inputs,
    function(input, next) {
      self._populateInput(db, input, poolTransactions, next);
    },
    callback
  );
};

Transaction.prototype._populateInput = function(db, input, poolTransactions, callback) {
  if (!input.prevTxId || !Buffer.isBuffer(input.prevTxId)) {
    return callback(new Error('Input is expected to have prevTxId as a buffer'));
  }
  var txid = input.prevTxId.toString('hex');
  db.getTransaction(txid, true, function(err, prevTx) {
    if(err instanceof levelup.errors.NotFoundError) {
      // Check the pool for transaction
      for(var i = 0; i < poolTransactions.length; i++) {
        if(txid === poolTransactions[i].hash) {
          input.output = poolTransactions[i].outputs[input.outputIndex];
          return callback();
        }
      }

      return callback(new Error('Previous tx ' + input.prevTxId.toString('hex') + ' not found'));
    } else if(err) {
      callback(err);
    } else {
      input.output = prevTx.outputs[input.outputIndex];
      callback();
    }
  });
};

Transaction.prototype._checkSpent = function(db, input, poolTransactions, callback) {
  // TODO check and see if another transaction in the pool spent the output
  db.isSpentDB(input, function(spent) {
    if(spent) {
      return callback(new Error('Input already spent'));
    } else {
      callback();
    }
  });
};

module.exports = Transaction;
