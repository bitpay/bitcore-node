'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var Transaction = require('../../transaction');
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var Hash = bitcore.crypto.Hash;
var BufferReader = bitcore.encoding.BufferReader;
var EventEmitter = require('events').EventEmitter;
var PublicKey = bitcore.PublicKey;
var Address = bitcore.Address;
var AddressHistory = require('./history');

var AddressService = function(options) {
  BaseService.call(this, options);

  this.subscriptions = {};
  this.subscriptions['address/transaction'] = {};
  this.subscriptions['address/balance'] = {};

  this.node.services.bitcoind.on('tx', this.transactionHandler.bind(this));

  this.mempoolOutputIndex = {};
  this.mempoolInputIndex = {};
  this.mempoolSpentIndex = {};

};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db'
];

AddressService.PREFIXES = {
  OUTPUTS: new Buffer('02', 'hex'),
  SPENTS: new Buffer('03', 'hex')
};

AddressService.SPACER_MIN = new Buffer('00', 'hex');
AddressService.SPACER_MAX = new Buffer('ff', 'hex');

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
};

AddressService.prototype.getPublishEvents = function() {
  return [
    {
      name: 'address/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'address/transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'address/transaction')
    },
    {
      name: 'address/balance',
      scope: this,
      subscribe: this.subscribe.bind(this, 'address/balance'),
      unsubscribe: this.unsubscribe.bind(this, 'address/balance')
    }
  ];
};

/**
 * Will process each output of a transaction from the daemon "tx" event, and construct
 * an object with the data for the message to be relayed to any subscribers for an address.
 *
 * @param {Object} messages - An object to collect messages
 * @param {Transaction} tx - Instance of the transaction
 * @param {Number} outputIndex - The index of the output in the transaction
 * @param {Boolean} rejected - If the transaction was rejected by the mempool
 */
AddressService.prototype.transactionOutputHandler = function(messages, tx, outputIndex, rejected) {
  var script = tx.outputs[outputIndex].script;

  // If the script is invalid skip
  if (!script) {
    return;
  }

  var addressInfo = this._extractAddressInfoFromScript(script);
  if (!addressInfo) {
    return;
  }

  addressInfo.hashHex = addressInfo.hashBuffer.toString('hex');

  // Collect data to publish to address subscribers
  if (messages[addressInfo.hashHex]) {
    messages[addressInfo.hashHex].outputIndexes.push(outputIndex);
  } else {
    messages[addressInfo.hashHex] = {
      tx: tx,
      outputIndexes: [outputIndex],
      addressInfo: addressInfo,
      rejected: rejected
    };
  }
};

/**
 * This will handle data from the daemon "tx" event, go through each of the outputs
 * and send messages to any subscribers for a particular address.
 *
 * @param {Object} txInfo - The data from the daemon.on('tx') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {Boolean} txInfo.mempool - If the transaction was accepted in the mempool
 * @param {String} txInfo.hash - The hash of the transaction
 */
AddressService.prototype.transactionHandler = function(txInfo) {

  // Basic transaction format is handled by the daemon
  // and we can safely assume the buffer is properly formatted.
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);

  var messages = {};

  var outputsLength = tx.outputs.length;
  for (var i = 0; i < outputsLength; i++) {
    this.transactionOutputHandler(messages, tx, i, !txInfo.mempool);
  }

  // Update mempool index
  if (txInfo.mempool) {
    this.updateMempoolIndex(tx);
  }

  for (var key in messages) {
    this.transactionEventHandler(messages[key]);
  }
};

AddressService.prototype.updateMempoolIndex = function(tx) {
  var outputLength = tx.outputs.length;
  for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
    var output = tx.outputs[outputIndex];
    if (!output.script) {
      continue;
    }
    var addressInfo = this._extractAddressInfoFromScript(output.script);
    if (!addressInfo) {
      continue;
    }

    var addressStr = bitcore.Address({
      hashBuffer: addressInfo.hashBuffer,
      type: addressInfo.addressType,
      network: this.node.network
    }).toString();

    if (!this.mempoolOutputIndex[addressStr]) {
      this.mempoolOutputIndex[addressStr] = [];
    }

    this.mempoolOutputIndex[addressStr].push({
      txid: tx.hash, // TODO use buffer
      outputIndex: outputIndex,
      satoshis: output.satoshis,
      script: output._scriptBuffer.toString('hex') //TODO use a buffer
    });

  }
  var inputLength = tx.inputs.length;
  for (var inputIndex = 0; inputIndex < inputLength; inputIndex++) {

    var input = tx.inputs[inputIndex];

    // Update spent index
    var spentIndexKey = [input.prevTxId.toString('hex'), input.outputIndex].join('-');
    this.mempoolSpentIndex[spentIndexKey] = true;

    var address = input.script.toAddress(this.node.network);
    if (!address) {
      continue;
    }
    var addressStr = address.toString();
    if (!this.mempoolInputIndex[addressStr]) {
      this.mempoolInputIndex[addressStr] = [];
    }
    this.mempoolInputIndex[addressStr].push({
      txid: tx.hash, // TODO use buffer
      inputIndex: inputIndex
    });
  }

};

AddressService.prototype.resetMempoolIndex = function(callback) {
  var self = this;
  var transactionBuffers = self.node.services.bitcoind.getMempoolTransactions();
  this.mempoolInputIndex = {};
  this.mempoolOutputIndex = {};
  this.mempoolSpentIndex = {};
  async.each(transactionBuffers, function(txBuffer, next) {
    var tx = Transaction().fromBuffer(txBuffer);
    self.updateMempoolIndex(tx);
    setImmediate(next);
  }, function(err) {
    if (err) {
      return callback(err);
    }
    callback();
  });
};

AddressService.prototype._extractAddressInfoFromScript = function(script) {
  var hashBuffer;
  var addressType;
  if (script.isPublicKeyHashOut()) {
    hashBuffer = script.chunks[2].buf;
    addressType = Address.PayToPublicKeyHash;
  } else if (script.isScriptHashOut()) {
    hashBuffer = script.chunks[1].buf;
    addressType = Address.PayToScriptHash;
  } else if (script.isPublicKeyOut()) {
    var pubkey = script.chunks[0].buf;
    var address = Address.fromPublicKey(new PublicKey(pubkey), this.node.network);
    hashBuffer = address.hashBuffer;
    // pay-to-publickey doesn't have an address, however for compatibility
    // purposes, we can create an address
    addressType = Address.PayToPublicKeyHash;
  } else {
    return false;
  }
  return {
    hashBuffer: hashBuffer,
    addressType: addressType
  };
};

AddressService.prototype.blockHandler = function(block, addOutput, callback) {
  var txs = block.transactions;
  var height = block.__height;

  var action = 'put';
  if (!addOutput) {
    action = 'del';
  }

  var operations = [];

  var transactionLength = txs.length;
  for (var i = 0; i < transactionLength; i++) {

    var tx = txs[i];
    var txid = tx.id;
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    // Subscription messages
    var txmessages = {};

    var outputLength = outputs.length;
    for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      var output = outputs[outputIndex];

      var script = output.script;

      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      var addressInfo = this._extractAddressInfoFromScript(script);
      if (!addressInfo) {
        continue;
      }

      // We need to use the height for indexes (and not the timestamp) because the
      // the timestamp has unreliable sequential ordering. The next block
      // can have a time that is previous to the previous block (however not
      // less than the mean of the 11 previous blocks) and not greater than 2
      // hours in the future.
      var key = this._encodeOutputKey(addressInfo.hashBuffer, height, txid, outputIndex);
      var value = this._encodeOutputValue(output.satoshis, output._scriptBuffer);
      operations.push({
        type: action,
        key: key,
        value: value
      });

      addressInfo.hashHex = addressInfo.hashBuffer.toString('hex');

      // Collect data for subscribers
      if (txmessages[addressInfo.hashHex]) {
        txmessages[addressInfo.hashHex].outputIndexes.push(outputIndex);
      } else {
        txmessages[addressInfo.hashHex] = {
          tx: tx,
          height: height,
          outputIndexes: [outputIndex],
          addressInfo: addressInfo,
          timestamp: block.header.timestamp
        };
      }

      this.balanceEventHandler(block, addressInfo);

    }

    // Publish events to any subscribers for this transaction
    for (var addressKey in txmessages) {
      this.transactionEventHandler(txmessages[addressKey]);
    }

    if(tx.isCoinbase()) {
      continue;
    }

    for(var inputIndex = 0; inputIndex < inputs.length; inputIndex++) {

      var input = inputs[inputIndex];
      var inputHash;

      if (input.script.isPublicKeyHashIn()) {
        inputHash = Hash.sha256ripemd160(input.script.chunks[1].buf);
      } else if (input.script.isScriptHashIn()) {
        inputHash = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
      } else {
        continue;
      }

      // To be able to query inputs by address and spent height
      var inputKey = this._encodeInputKey(inputHash, height, input.prevTxId, input.outputIndex);
      var inputValue = this._encodeInputValue(txid, inputIndex);

      operations.push({
        type: action,
        key: inputKey,
        value: inputValue
      });
    }
  }

  setImmediate(function() {
    callback(null, operations);
  });
};

AddressService.prototype._encodeOutputKey = function(hashBuffer, height, txid, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var key = Buffer.concat([
    AddressService.PREFIXES.OUTPUTS,
    hashBuffer,
    AddressService.SPACER_MIN,
    heightBuffer,
    new Buffer(txid, 'hex'), //TODO get buffer directly from tx
    outputIndexBuffer
  ]);
  return key;
};

AddressService.prototype._decodeOutputKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(1);
  var hashBuffer = reader.read(20);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var txid = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    height: height,
    txid: txid,
    outputIndex: outputIndex
  };
};

AddressService.prototype._encodeOutputValue = function(satoshis, scriptBuffer) {
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([satoshisBuffer, scriptBuffer]);
};

AddressService.prototype._decodeOutputValue = function(buffer) {
  var satoshis = buffer.readDoubleBE(0);
  var scriptBuffer = buffer.slice(8, buffer.length);
  return {
    satoshis: satoshis,
    scriptBuffer: scriptBuffer
  };
};

AddressService.prototype._encodeInputKey = function(hashBuffer, height, prevTxIdBuffer, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([
    AddressService.PREFIXES.SPENTS,
    hashBuffer,
    AddressService.SPACER_MIN,
    heightBuffer,
    prevTxIdBuffer,
    outputIndexBuffer
  ]);
};

AddressService.prototype._decodeInputKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(1);
  var hashBuffer = reader.read(20);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var prevTxId = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    height: height,
    prevTxId: prevTxId,
    outputIndex: outputIndex
  };
};

AddressService.prototype._encodeInputValue = function(txid, inputIndex) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  return Buffer.concat([
    new Buffer(txid, 'hex'),
    inputIndexBuffer
  ]);
};

AddressService.prototype._decodeInputValue = function(buffer) {
  var txid = buffer.slice(0, 32);
  var inputIndex = buffer.readUInt32BE(32);
  return {
    txid: txid,
    inputIndex: inputIndex
  };
};

/**
 * @param {Object} obj
 * @param {Transaction} obj.tx - The transaction
 * @param {Object} obj.addressInfo
 * @param {String} obj.addressInfo.hashHex - The hex string of address hash for the subscription
 * @param {String} obj.addressInfo.hashBuffer - The address hash buffer
 * @param {String} obj.addressInfo.addressType - The address type
 * @param {Array} obj.outputIndexes - Indexes of the inputs that includes the address
 * @param {Array} obj.inputIndexes - Indexes of the outputs that includes the address
 * @param {Date} obj.timestamp - The time of the block the transaction was included
 * @param {Number} obj.height - The height of the block the transaction was included
 * @param {Boolean} obj.rejected - If the transaction was not accepted in the mempool
 */
AddressService.prototype.transactionEventHandler = function(obj) {
  if(this.subscriptions['address/transaction'][obj.addressInfo.hashHex]) {
    var emitters = this.subscriptions['address/transaction'][obj.addressInfo.hashHex];
    var address = new Address({
      hashBuffer: obj.addressInfo.hashBuffer,
      network: this.node.network,
      type: obj.addressInfo.addressType
    });
    for(var i = 0; i < emitters.length; i++) {
      emitters[i].emit('address/transaction', {
        rejected: obj.rejected,
        height: obj.height,
        timestamp: obj.timestamp,
        inputIndexes: obj.inputIndexes,
        outputIndexes: obj.outputIndexes,
        address: address,
        tx: obj.tx
      });
    }
  }
};

/**
 * @param {Block} block
 * @param {Object} obj
 * @param {String} obj.hashHex
 * @param {Buffer} obj.hashBuffer
 * @param {String} obj.addressType
 */
AddressService.prototype.balanceEventHandler = function(block, obj) {
  if(this.subscriptions['address/balance'][obj.hashHex]) {
    var emitters = this.subscriptions['address/balance'][obj.hashHex];
    var address = new Address({
      hashBuffer: obj.hashBuffer,
      network: this.node.network,
      type: obj.addressType
    });
    this.getBalance(address, true, function(err, balance) {
      if(err) {
        return this.emit(err);
      }
      for(var i = 0; i < emitters.length; i++) {
        emitters[i].emit('address/balance', address, balance, block);
      }
    });
  }
};

AddressService.prototype.subscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses), 'Second argument is expected to be an Array of addresses');

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(!this.subscriptions[name][hashHex]) {
      this.subscriptions[name][hashHex] = [];
    }
    this.subscriptions[name][hashHex].push(emitter);
  }
};

AddressService.prototype.unsubscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses) || _.isUndefined(addresses), 'Second argument is expected to be an Array of addresses or undefined');

  if(!addresses) {
    return this.unsubscribeAll(name, emitter);
  }

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(this.subscriptions[name][hashHex]) {
      var emitters = this.subscriptions[name][hashHex];
      var index = emitters.indexOf(emitter);
      if(index > -1) {
        emitters.splice(index, 1);
      }
    }
  }
};

AddressService.prototype.unsubscribeAll = function(name, emitter) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');

  for(var hashHex in this.subscriptions[name]) {
    var emitters = this.subscriptions[name][hashHex];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
    }
  }
};

AddressService.prototype.getBalance = function(address, queryMempool, callback) {
  this.getUnspentOutputs(address, queryMempool, function(err, outputs) {
    if(err) {
      return callback(err);
    }

    var satoshis = outputs.map(function(output) {
      return output.satoshis;
    });

    var sum = satoshis.reduce(function(a, b) {
      return a + b;
    }, 0);

    return callback(null, sum);
  });
};

/**
 * @param {String} addressStr - The relevant address
 * @param {Object} options - Additional options for query the outputs
 * @param {Number} [options.start] - The relevant start block height
 * @param {Number} [options.end] - The relevant end block height
 * @param {Boolean} [options.queryMempool] - Include the mempool in the results
 * @param {Function} callback
 */
AddressService.prototype.getInputs = function(addressStr, options, callback) {

  var self = this;

  var inputs = [];
  var stream;

  var hashBuffer = bitcore.Address(addressStr).hashBuffer;

  if (options.start && options.end) {

    var endBuffer = new Buffer(4);
    endBuffer.writeUInt32BE(options.end);

    var startBuffer = new Buffer(4);
    startBuffer.writeUInt32BE(options.start + 1);

    stream = this.node.services.db.store.createReadStream({
      gte: Buffer.concat([
        AddressService.PREFIXES.SPENTS,
        hashBuffer,
        AddressService.SPACER_MIN,
        endBuffer
      ]),
      lte: Buffer.concat([
        AddressService.PREFIXES.SPENTS,
        hashBuffer,
        AddressService.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer]);
    stream = this.node.services.db.store.createReadStream({
      gte: Buffer.concat([allKey, AddressService.SPACER_MIN]),
      lte: Buffer.concat([allKey, AddressService.SPACER_MAX]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  }

  stream.on('data', function(data) {

    var key = self._decodeInputKey(data.key);
    var value = self._decodeInputValue(data.value);

    var input = {
      address: addressStr,
      txid: value.txid.toString('hex'),
      inputIndex: value.inputIndex,
      height: key.height,
      confirmations: self.node.services.db.tip.__height - key.height + 1
    };

    inputs.push(input);

  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('close', function() {
    if (error) {
      return callback(error);
    }

    if(options.queryMempool) {
      var mempoolInputs = self.mempoolInputIndex[addressStr];
      if (mempoolInputs) {
        for(var i = 0; i < mempoolInputs.length; i++) {
          // TODO copy
          var newInput = mempoolInputs[i];
          newInput.address = addressStr;
          newInput.height = -1;
          newInput.confirmations = 0;
          inputs.push(newInput);
        }
      }
    }

    callback(null, inputs);

  });

  return stream;

};

/**
 * @param {String} addressStr - The relevant address
 * @param {Object} options - Additional options for query the outputs
 * @param {Number} [options.start] - The relevant start block height
 * @param {Number} [options.end] - The relevant end block height
 * @param {Boolean} [options.queryMempool] - Include the mempool in the results
 * @param {Function} callback
 */
AddressService.prototype.getOutputs = function(addressStr, options, callback) {
  var self = this;
  $.checkArgument(_.isObject(options), 'Second argument is expected to be an options object.');
  $.checkArgument(_.isFunction(callback), 'Third argument is expected to be a callback function.');

  var hashBuffer = bitcore.Address(addressStr).hashBuffer;

  var outputs = [];
  var stream;

  if (options.start && options.end) {

    var startBuffer = new Buffer(4);
    startBuffer.writeUInt32BE(options.start + 1);
    var endBuffer = new Buffer(4);
    endBuffer.writeUInt32BE(options.end);

    stream = this.node.services.db.store.createReadStream({
      gte: Buffer.concat([
        AddressService.PREFIXES.OUTPUTS,
        hashBuffer,
        AddressService.SPACER_MIN,
        endBuffer
      ]),
      lte: Buffer.concat([
        AddressService.PREFIXES.OUTPUTS,
        hashBuffer,
        AddressService.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([AddressService.PREFIXES.OUTPUTS, hashBuffer]);
    stream = this.node.services.db.store.createReadStream({
      gte: Buffer.concat([allKey, AddressService.SPACER_MIN]),
      lte: Buffer.concat([allKey, AddressService.SPACER_MAX]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  }

  stream.on('data', function(data) {

    var key = self._decodeOutputKey(data.key);
    var value = self._decodeOutputValue(data.value);

    var output = {
      address: addressStr,
      txid: key.txid.toString('hex'), //TODO use a buffer
      outputIndex: key.outputIndex,
      height: key.height,
      satoshis: value.satoshis,
      script: value.scriptBuffer.toString('hex'), //TODO use a buffer
      confirmations: self.node.services.db.tip.__height - key.height + 1
    };

    outputs.push(output);

  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('close', function() {
    if (error) {
      return callback(error);
    }

    if(options.queryMempool) {
      var mempoolOutputs = self.mempoolOutputIndex[addressStr];
      if (mempoolOutputs) {
        for(var i = 0; i < mempoolOutputs.length; i++) {
          // TODO copy
          var newOutput = mempoolOutputs[i];
          newOutput.address = addressStr;
          newOutput.height = -1;
          newOutput.confirmations = 0;
          outputs.push(newOutput);
        }
      }
    }
    callback(null, outputs);
  });

  return stream;

};

AddressService.prototype.getUnspentOutputs = function(addresses, queryMempool, callback) {
  var self = this;

  if(!Array.isArray(addresses)) {
    addresses = [addresses];
  }

  var utxos = [];

  async.eachSeries(addresses, function(address, next) {
    self.getUnspentOutputsForAddress(address, queryMempool, function(err, unspents) {
      if(err && err instanceof errors.NoOutputs) {
        return next();
      } else if(err) {
        return next(err);
      }

      utxos = utxos.concat(unspents);
      next();
    });
  }, function(err) {
    callback(err, utxos);
  });
};

AddressService.prototype.getUnspentOutputsForAddress = function(address, queryMempool, callback) {

  var self = this;

  this.getOutputs(address, {queryMempool: queryMempool}, function(err, outputs) {
    if (err) {
      return callback(err);
    } else if(!outputs.length) {
      return callback(new errors.NoOutputs('Address ' + address + ' has no outputs'), []);
    }

    var isUnspent = function(output, callback) {
      self.isUnspent(output, queryMempool, callback);
    };

    async.filter(outputs, isUnspent, function(results) {
      callback(null, results);
    });
  });
};

AddressService.prototype.isUnspent = function(output, queryMempool, callback) {
  this.isSpent(output, queryMempool, function(spent) {
    callback(!spent);
  });
};

AddressService.prototype.isSpent = function(output, queryMempool, callback) {
  var self = this;
  var txid = output.prevTxId ? output.prevTxId.toString('hex') : output.txid;

  setImmediate(function() {
    callback(self.node.services.bitcoind.isSpent(txid, output.outputIndex));
  });
};

/**
 * This will give the history for many addresses limited by a range of block heights (to limit
 * the database lookup times) and/or paginated to limit the results length.
 *
 * The response format will be:
 * {
 *   totalCount: 12 // the total number of items there are between the two heights
 *   items: [
 *     {
 *       addresses: {
 *         '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX': {
 *           inputIndexes: [],
 *           outputIndexes: [0]
 *         }
 *       },
 *       satoshis: 100,
 *       height: 300000,
 *       confirmations: 1,
 *       timestamp: 1442337090 // in seconds
 *       fees: 1000 // in satoshis
 *       tx: <Transaction>
 *     }
 *   ]
 * }
 * @param {Array} addresses - An array of addresses
 * @param {Object} options - The options to limit the query
 * @param {Number} [options.from] - The pagination "from" index
 * @param {Number} [options.to] - The pagination "to" index
 * @param {Number} [options.start] - The beginning block height (e.g. 1500 the most recent block height).
 * @param {Number} [options.end] - The ending block height (e.g. 0 the older block height, results are inclusive).
 * @param {Boolean} [options.queryMempool] - Include the mempool in the query
 * @param {Function} callback
 */
AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var history = new AddressHistory({
    node: this.node,
    options: options,
    addresses: addresses
  });
  history.get(callback);
};

/**
 * This will return an object with:
 *   balance - confirmed balance
 *   unconfirmedBalance - unconfirmed balance
 *   totalReceived - satoshis received
 *   totalSpent - satoshis spent
 *   appearances - number of times used in confirmed transactions
 *   unconfirmedAppearances - number of times used in unconfirmed transactions
 *   txids - list of txids (unless noTxList is set)
 *
 * @param {String} address
 * @param {Object} options
 * @param {Boolean} options.noTxList - if set, txid array will not be included
 * @param {Function} callback
 */
AddressService.prototype.getAddressSummary = function(address, options, callback) {
  var self = this;

  var opt = {
    queryMempool: true
  };

  var outputs;
  var inputs;

  async.parallel(
    [
      function(next) {
        self.getInputs(address, opt, function(err, ins) {
          inputs = ins;
          next(err);
        });
      },
      function(next) {
        self.getOutputs(address, opt, function(err, outs) {
          outputs = outs;
          next(err);
        });
      }
    ],
    function(err) {
      if(err) {
        return callback(err);
      }

      var totalReceived = 0;
      var totalSpent = 0;
      var balance = 0;
      var unconfirmedBalance = 0;
      var appearanceIds = {};
      var unconfirmedAppearanceIds = {};
      var txids = [];

      for(var i = 0; i < outputs.length; i++) {
        // Bitcoind's isSpent at the moment only works for confirmed transactions
        var spentDB = self.node.services.bitcoind.isSpent(outputs[i].txid, outputs[i].outputIndex);
        var spentIndexKey = [outputs[i].txid, outputs[i].outputIndex].join('-');
        var spentMempool = self.mempoolSpentIndex[spentIndexKey];

        txids.push(outputs[i]);
        unconfirmedBalance += outputs[i].satoshis;
        if(outputs[i].confirmations) {
          totalReceived += outputs[i].satoshis;
          balance += outputs[i].satoshis;
          appearanceIds[outputs[i].txid] = true;
        } else {
          unconfirmedAppearanceIds[outputs[i].txid] = true;
        }

        if(spentDB || spentMempool) {
          unconfirmedBalance -= outputs[i].satoshis;
          if(spentDB) {
            totalSpent += outputs[i].satoshis;
            balance -= outputs[i].satoshis;
          }
        }
      }

      for(var j = 0; j < inputs.length; j++) {
        if (inputs[j].confirmations) {
          appearanceIds[inputs[j].txid] = true;
        } else {
          unconfirmedAppearanceIds[outputs[j].txid] = true;
        }
      }

      var summary = {
        totalReceived: totalReceived,
        totalSpent: totalSpent,
        balance: balance,
        unconfirmedBalance: unconfirmedBalance,
        appearances: Object.keys(appearanceIds).length,
        unconfirmedAppearances: Object.keys(unconfirmedAppearanceIds).length
      };

      if(!options.noTxList) {
        for(var i = 0; i < inputs.length; i++) {
          txids.push(inputs[i]);
        }

        // sort by height
        txids = txids.sort(function(a, b) {
          return a.height > b.height ? 1 : -1;
        }).map(function(obj) {
          return obj.txid;
        }).filter(function(value, index, self) {
          return self.indexOf(value) === index;
        });

        summary.txids = txids;
      }

      callback(null, summary);
    }
  );
};

module.exports = AddressService;
