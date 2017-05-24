'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');

function UtxoService(options) {
  BaseService.call(this, options);
  this._createConcurrencyCache({ max: 500000, dispose: this._getUtxoOperations.bind(this) });
  this._operations = [];
}

inherits(UtxoService, BaseService);

UtxoService.dependencies = ['db'];

UtxoService.prototype.start = function(callback) {
  var self = this;

  self.db = this.node.services.db;

  self.db.getPrefix(self.name, function(err, prefix) {
    if (err) {
      return callback(err);
    }
    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    callback();
  });
};

UtxoService.prototype.stop = function(callback) {
  if (callback) {
    setImmediate(callback);
  }
};

UtxoService.prototype.concurrencyBlockHandler = function(block, connect, callback) {

  var self = this;
  var reverseAction = connect ? 'del' : 'put';
  var action = connect ? 'put' : 'del';

  for(var i = 0; i < block.transactions.length; i++) {

    var tx = block.transactions[i];
    var inputs = tx.inputs;
    var outputs = tx.outputs;
    var skipOutput = [];

    for(var j = 0; j < inputs.length; j++) {
      var input = inputs[j];

      if (tx.isCoinbase()) {
        continue;
      }

      if (input.prevHash === tx.hash) {
        skipOutput.push(input.outputIndex);
        continue;
      }

      self._concurrencyCache.del(input.prevHash + input.outputTndex);
    }

    for(var k = 0; k < inputs.length; k++) {

      if (skipOutput.indexOf(k) !== -1) {
        continue;
      }

      var output = outputs[k];
      self._concurrencyCache.set(tx.hash + k, {
        output: output,
        height: block.__height,
        hash: block.hash
      }); // key = 36 bytes, value = (8 + 25ish) + 36 = 69 bytes
    }
  }

  setImmediate(callback);

};

UtxoService.prototype._getUtxoOperations = function(key, value) {
  this._operations.push({
    action: 'put',
    key: this._getKey(key),
    value: this._getValue(value)
  });
};

module.exports = UtxoService;
