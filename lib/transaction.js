'use strict';

var async = require('async');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;
var chainlib = require('chainlib');
var BaseTransaction = chainlib.Transaction;
var BaseDatabase = chainlib.DB;
var levelup = chainlib.deps.levelup;
var _ = bitcore.deps._;

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

Transaction.manyToBuffer = function(transactions) {
  return BaseTransaction.manyToBuffer(transactions);
};

/**
 * Override Bitcore's toObject() to include populated inputs and txid
 */
Transaction.prototype.toObject = function toObject() {
  var inputs = [];
  this.inputs.forEach(function(input) {
    var inputObj = input.toObject();
    if(input.output) {
      inputObj.output = input.output.toObject();
    }
    inputs.push(inputObj);
  });
  var outputs = [];
  this.outputs.forEach(function(output) {
    outputs.push(output.toObject());
  });
  var obj = {
    txid: this.id,
    version: this.version,
    inputs: inputs,
    outputs: outputs,
    nLockTime: this.nLockTime
  };
  if (this._changeScript) {
    obj.changeScript = this._changeScript.toString();
  }
  if (!_.isUndefined(this._changeIndex)) {
    obj.changeIndex = this._changeIndex;
  }
  if (!_.isUndefined(this._fee)) {
    obj.fee = this._fee;
  }
  return obj;
};

module.exports = Transaction;
