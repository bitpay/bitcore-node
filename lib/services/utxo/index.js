'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var LRU = require('lru-cache');

function UtxoService(options) {
  BaseService.call(this, options);
  this._createCache({ max: 500000, dispose: this._getUtxoOperations.bind(this) });
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

UtxoService.prototype._processInputs = function(inputs, block, connect) {

  var ret = [];

  for(var i = 0; i < inputs.length; i++) {
    var input = inputs[i];

    var key = input.prevHash + input.outputIndex;

    if (input.prevTxId === tx.hash) {
      ret.push(i);
      continue;
    }

    if (connect) {
      self._removeSpentOutput(key);
    } else {
      self._readdUnspentOutput(key);
    }
  }

  return ret;
};

UtxoService.prototype._processOutputs = function(outputs, exclusions, block, connect) {

  for(var i = 0; i < outputs.length; i++) {

    var output = outputs[i];
    var key = tx.hash + i;

    if (exclusions.indexOf(i) > -1) {
      continue;
    }

    self._setCache(key, block, output);

  }

};

UtxoService.prototype._setCache = function(key, block, output) {

    self._cache.set(key, {
      output: output,
      height: block.__height,
      hash: block.hash,
    }); // key = 36 bytes, value = (8 + 25ish) + 36 = 69 bytes

};

UtxoService.prototype._removeSpentOutput = function(key) {

  var output = self._cache.peek(key);

  // we don't want nuke out our
  if (!output) {
    return { action: 'del', key: key };
  }

};

UtxoService.prototype._readdSpentOutput = function(key) {

  var output = self._cache.get(key);

  if (!output) {
  }
};
/*
connect:
  1. for all txs, for each input in the tx, remove the output that this input is spending

*/
UtxoService.prototype.blockHandler = function(block, connect) {

  var self = this;
  var operations = [];

  for(var i = 0; i < block.transactions.length; i++) {

    var tx = block.transactions[i];
    var inputs = tx.inputs;
    var outputs = tx.outputs;
    var inputOperations = {};

    if (!tx.isCoinbase()) {
      inputOperations = self._processInputs(inputs, block, connect);
    }

    var outputRes = self._processOutputs(outputs, inputRes.exclusions || [], block, connect);
    operations = operations.concat(inputRes.operations || []).concat(outputRes.operations);
  }

  return operations;
};

UtxoService.prototype._getUtxoOperations = function(key, value) {
  this._operations.push({
    action: 'put',
    key: this._getOperationsKey(key, value),
    value: this._getOperationsValue(value)
  });
};

UtxoService.prototype._getOperationsKey = function(key, value) {
  var address = utils.getAddressFromScript(value.output.script);
  return self.encoding.encodeUtxoIndexKey(address, key.slice(0, 32), parseInt(key.slice(32)));
};

UtxoService.prototype._getOperationsValue = function(value) {
  return self.encoding.encodeUtxoIndexValue(value.height, value.output.satoshis, value.output.script);
};

module.exports = UtxoService;
