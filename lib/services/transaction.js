'use strict';
var BaseService = require('../../service');
var inherits = require('util').inherits;

function TransactionService(options) {
  BaseService.call(this, options);

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

  for(var i = 0; i < block.transactions.length; i++) {
    var tx = block.transactions[i];

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

TransactionService.prototype._encodeTransactionKey = function(txid) {
  return Buffer.concat([this.prefix, new Buffer(txid, 'hex')]);
};

TransactionService.prototype._decodeTransactionKey = function(buffer) {
  return buffer.slice(1).toString('hex');
};

TransactionService.prototype._encodeTransactionValue = function(transaction, height) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  return new Buffer.concat([heightBuffer, transaction.uncheckedSerialize()]);
};

TransactionService.prototype._decodeTransactionValue = function(buffer) {
  return {
    height: Buffer.readUInt32BE(height),
    transaction: new bitcore.Transaction(buffer)
  };
};

module.exports = TransactionService;
