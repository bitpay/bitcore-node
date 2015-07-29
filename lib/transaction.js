'use strict';

var async = require('async');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;
var chainlib = require('chainlib');
var BaseTransaction = chainlib.Transaction;
var BaseDatabase = chainlib.DB;
var levelup = chainlib.deps.levelup;

Transaction.prototype.validate = function(db, poolTransactions, callback) {
  var self = this;

  if (!(db instanceof BaseDatabase)) {
    throw new Error('First argument is expected to be an instance of Database');
  }

  // coinbase is valid
  if (this.isCoinbase()) {
    return callback();
  }

  var verified = this.verify();
  if(verified !== true) {
    return callback(new Error(verified));
  }

  async.series(
    [
      self._validateInputs.bind(self, db, poolTransactions),
      self._validateOutputs.bind(self),
      self._checkSufficientInputs.bind(self)
    ],
    callback
  );
};

Transaction.prototype._validateInputs = function(db, poolTransactions, callback) {
  var self = this;

  // Verify inputs are unspent
  async.each(self.inputs, function(input, next) {
    async.series(
      [
        self._populateInput.bind(self, db, input, poolTransactions),
        self._checkSpent.bind(self, db, input, poolTransactions),
        self._checkScript.bind(self, db, input, self.inputs.indexOf(input))
      ],
      next
    );
  }, callback);
};

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
  db.getTransaction(txid, false, function(err, prevTx) {
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

Transaction.prototype._checkScript = function(db, input, index, callback) {
  if (input.output.script) {
    var scriptPubkey = input.output._scriptBuffer;
    var txTo = this.toBuffer();
    var valid = db.bitcoind.verifyScript(scriptPubkey, txTo, index);
    if(valid) {
      return callback();
    }
  }
  return callback(new Error('Script does not validate'));
};

Transaction.prototype._validateOutputs = function(callback) {
  setImmediate(callback);
};

Transaction.prototype._checkSufficientInputs = function(callback) {
  var inputTotal = this._getInputAmount();
  var outputTotal = this._getOutputAmount();
  if(inputTotal < outputTotal) {
    return callback(new Error('Insufficient inputs'));
  } else {
    return callback();
  }
};

Transaction.manyToBuffer = function(transactions) {
  return BaseTransaction.manyToBuffer(transactions);
};

module.exports = Transaction;
