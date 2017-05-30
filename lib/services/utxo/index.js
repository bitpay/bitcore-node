'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var utils = require('../../utils');
var index = require('../../');
var log = index.log;

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

  setImmediate(function() {
    callback(null, operations);
  });
};

UtxoService.prototype.getUtxosForAddress = function(address, callback) {

  var self = this;
  var utxos = [];

  var start = self.encoding.encodeUtxoIndexKey(address);

  var stream = self.db.createReadStream({
    gte: start,
    lt: utils.getTerminalKey(start)
  });

  stream.on('data', function(data) {

    var key = self.encoding.decodeUtxoIndexKey(data.key);
    var value = self.encoding.decodeUtxoIndexValue(data.value);
    utxos.push({
      address: address,
      txId: key.txid,
      outputIndex: key.outputIndex,
      height: value.height,
      satoshis: value.satoshis,
      script: value.script.toString('hex')
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

    if (input.prevTxId === tx.hash) {
      this._exlusionIndexes.push(i);
      continue;
    }

    var key = this._getOperationsKey({
      script: input.script,
      txid: input.prevTxId.toString('hex'),
      index: input.outputIndex
    });

    if (key) {
      var operation = connect ? {
        type: 'del',
        key: key
      } : {
        type: 'put',
        key: key,
        value: new Buffer('00', 'hex')
      };

      operations.push(operation);
    }
  }

  return operations;

};

UtxoService.prototype._processOutputs = function(tx, outputs, block, connect) {

  var operations = [];
  for(var i = 0; i < outputs.length; i++) {

    var output = outputs[i];

    if (this._exclusionIndexes.indexOf(i) > -1) {
      continue;
    }

    var key = this._getOperationsKey({
      script: output.script,
      txid: tx.id,
      index: i
    });

    var value = this._getOperationsValue({
      height: block.__height,
      satoshis: output.satoshis,
      script: output.script
    });

    if (key && value) {
//console.log(this.encoding.decodeUtxoIndexKey(key));
      var operation = connect ? {
        type: 'put',
        key: key,
        value: value
      } : {
        type: 'del',
        key: key,
        value: value
      };

      operations.push(operation);
    }


  }

  return operations;

};

UtxoService.prototype._getOperationsKey = function(io) {

  var address = utils.getAddressStringFromScript(io.script, this.node.network);

  if (!address) {
    var key = this._tryP2PKOperation(io);
    if (key) {
      return key;
    }
  }

  if (!address) {
    log.debug('could not determine address for script: ' + io.script.toString());
    return;
  }

  return this.encoding.encodeUtxoIndexKey(address, io.txid, io.index);
};

UtxoService.prototype._tryP2PKOperation = function(io) {

  // checking for a scriptSig that has one signature
  var sig = io.script.chunks[0];
  if (sig && (sig.len > 69 && sig.len < 75)) {
    return this.encoding.encodeP2PKUtxoIndexKey(io.txid, io.index);
  }
};

UtxoService.prototype._getOperationsValue = function(value) {
  return this.encoding.encodeUtxoIndexValue(value.height, value.satoshis, value.script.toBuffer());
};

module.exports = UtxoService;
