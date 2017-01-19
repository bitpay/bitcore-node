'use strict';
var BaseService = require('../service');
var inherits = require('util').inherits;
var bitcore = require('bitcore-lib');

function TransactionService(options) {
  BaseService.call(this, options);

  this.currentTransactions = {};
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'db'
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
  var action = 'put';
  if (!connectBlock) {
    action = 'del';
  }

  var operations = [];

  this.currentTransactions = {};

  for(var i = 0; i < block.transactions.length; i++) {
    var tx = block.transactions[i];
    tx.__height = block.__height;

    this.currentTransactions[tx.id] = tx;

    operations.push({
      type: action,
      key: this._encodeTransactionKey(tx.id),
      value: this._encodeTransactionValue(tx)
    });
  }

  setImmediate(function() {
    callback(null, operations);
  });
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

TransactionService.prototype._encodeTransactionValue = function(transaction, height) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE();
  return new Buffer.concat([heightBuffer, transaction.toBuffer()]);
};

TransactionService.prototype._decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();
  var transaction = new bitcore.Transaction(buffer.slice(4));
  transaction.__height = height;
  return transaction;
};

module.exports = TransactionService;
