'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var LRU = require('lru-cache');

const REORG_BUFFER = 6;

function UtxoService(options) {
  BaseService.call(this, options);
  this._operations = [];
  this._createCache({ max: 500000, dispose: this._getUtxoOperations.bind(this) });
  this._exclusionIndexes = [];
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

UtxoService.prototype._processInputs = function(tx, inputs, connect) {

  var operations = [];
  for(var i = 0; i < inputs.length; i++) {
    var input = inputs[i];

    var key = input.prevHash + input.outputIndex;

    if (input.prevTxId === tx.hash) {
      this._exlusionIndexes.push(i);
      continue;
    }

    var ops = this._moveOutput(key, connect);
    operations = operations.concat(ops);
  }

  return operations;

};

UtxoService.prototype._processOutputs = function(tx, outputs, block, connect) {

  var operations = [];
  for(var i = 0; i < outputs.length; i++) {

    var output = outputs[i];
    var key = tx.hash + i;

    if (this._exclusionIndexes.indexOf(i) > -1) {
      continue;
    }

    if (connect) {
      //when the cache is full, we will write out.
      return this._setCache(key, block, output);
    }

    return this._cache.del(key);

  }

};

UtxoService.prototype._setCache = function(key, block, output, value) {

  if (!value) {
    value = {
      output: output,
      height: block.__height,
      hash: block.hash
    };
  }

  this._cache.set(key, value); // key = 36 bytes, value = (8 + 25ish) + 36 = 69 bytes

};

UtxoService.prototype._moveOutput = function(key, connect) {

  if (connect) {
    self._cache.del(key);
    return { action: 'del', key: key };
  }

  // this should only happen during a reorg, hopefully this is an infrequent occurence
  // the ramifications are that comsumers of this data will need to make an additional
  // lookup of the tx index. We are ok with trade-off for performance.
  return { action: 'put', key: key, value: null };

};

UtxoService.prototype.blockHandler = function(block, connect) {

  var self = this;

  self._currentBlockHeight = block.__height;
  self._exclusionIndexes.length = 0;
  var operations = [];

  for(var i = 0; i < block.transactions.length; i++) {

    var tx = block.transactions[i];
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    if (!tx.isCoinbase()) {
      operations = self._processInputs(tx, inputs, connect).concat(operations);
    }

    self._processOutputs(tx, outputs, block, connect);
  }

  operations = this._operations.concat(operations);
  this._operations.length = 0;

  return operations;
};

UtxoService.prototype._getUtxoOperations = function(key, value) {
  if (value.height + REORG_BUFFER >= self._currentHeight) {
    log.error('Writing utxos to the database before ' + REORG_BUFFER + ' confirmation blocks.' +
     ' The internal cache might be too small or the system does not have enough memory.');
  }
  this._operations.push({
    action: 'put',
    key: this._getOperationsKey(key, value),
    value: this._getOperationsValue(value)
  });
};

UtxoService.prototype._getOperationsKey = function(key, value) {
  var address = utils.getAddressStringFromScript(value.output.script, this.node.network);
  return self.encoding.encodeUtxoIndexKey(address, key.slice(0, 32), parseInt(key.slice(32)));
};

UtxoService.prototype._getOperationsValue = function(value) {
  return self.encoding.encodeUtxoIndexValue(value.height, value.output.satoshis, value.output.script);
};

module.exports = UtxoService;
