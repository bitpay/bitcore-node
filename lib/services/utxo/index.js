'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var LRU = require('lru-cache');
var utils = require('../../utils');

function UtxoService(options) {
  BaseService.call(this, options);
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

UtxoService.prototype.blockHandler = function(block, connect, callback) {

  var self = this;

  self._exclusionIndexes.length = 0;
  var operations = [];

  for(var i = 0; i < block.transactions.length; i++) {

    var tx = block.transactions[i];
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    if (!tx.isCoinbase()) {
      operations = self._processInputs(tx, inputs, connect).concat(operations);
    }

    operations = self._processOutputs(tx, outputs, block, connect).concat(operations);
  }

  callback(null, operations);
};

UtxoService.prototype.getUtxosForAddress = function(address, callback) {
  var self = this;
  var utxos = [];

  var start = self.encoding.encodeUtxoIndexKey(address);

  var stream = self.db.createReadStream({
    gte: start.slice(0, -36),
    lt: Buffer.concat([ start.slice(0, -36), new Buffer('ff', 'hex') ])
  });

  stream.on('data', function(data) {
    var key = self.encoding.decodeUtxoIndexKey(data.key);
    var value = self.encoding.decodeUtxoIndexValue(data.value);
    utxos.push({
      txid: key.txid,
      outputIndex: key.outputIndex,
      address: address,
      height: value.height,
      satoshis: value.satoshis,
      script: value.scriptBuffer
    });
  });

  stream.on('end', function() {
    callback(null, utxos);
  });
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

    var action = connect ? 'put' : 'del';
    operations = operations.concat(
      { action: action,
        key:  this._getOperationsKey(key, output),
        value: this._getOperationsValue({
          height: block.__height,
          satoshis: output.satoshis,
          script: output.script
        })
      }
    );
  }

  return operations;

};

UtxoService.prototype._moveOutput = function(key, connect) {

  if (connect) {
    return { action: 'del', key: key };
  }

  return { action: 'put', key: key, value: null };

};

UtxoService.prototype._getOperationsKey = function(key, output) {
  var address = utils.getAddressStringFromScript(output.script, this.node.network);
  return this.encoding.encodeUtxoIndexKey(address, key.slice(0, 64), parseInt(key.slice(64)));
};

UtxoService.prototype._getOperationsValue = function(value) {
  return this.encoding.encodeUtxoIndexValue(value.height, value.satoshis, value.script.toBuffer());
};

module.exports = UtxoService;
