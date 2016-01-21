'use strict';

var fs = require('fs');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var mkdirp = require('mkdirp');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var Networks = bitcore.Networks;
var levelup = require('levelup');
var leveldown = require('leveldown');
var memdown = require('memdown');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var Hash = bitcore.crypto.Hash;
var BufferReader = bitcore.encoding.BufferReader;
var EventEmitter = require('events').EventEmitter;
var PublicKey = bitcore.PublicKey;
var Address = bitcore.Address;
var AddressHistory = require('./history');

/**
 * The Address Service builds upon the Database Service and the Bitcoin Service to add additional
 * functionality for getting information by base58check encoded addresses. This includes getting the
 * balance for an address, the history for a collection of addresses, and unspent outputs for
 * constructing transactions. This is typically the core functionality for building a wallet.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 */
var AddressService = function(options) {
  BaseService.call(this, options);

  this.subscriptions = {};
  this.subscriptions['address/transaction'] = {};
  this.subscriptions['address/balance'] = {};

  this.node.services.bitcoind.on('tx', this.transactionHandler.bind(this));
  this.node.services.bitcoind.on('txleave', this.transactionLeaveHandler.bind(this));

  this._setMempoolIndexPath();
  if (options.mempoolMemoryIndex) {
    this.levelupStore = memdown;
  } else {
    this.levelupStore = leveldown;
  }
  this.mempoolIndex = null; // Used for larger mempool indexes
  this.mempoolSpentIndex = {}; // Used for small quick synchronous lookups
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db'
];

AddressService.PREFIXES = {
  OUTPUTS: new Buffer('02', 'hex'), // Query outputs by address and/or height
  SPENTS: new Buffer('03', 'hex'), // Query inputs by address and/or height
  SPENTSMAP: new Buffer('05', 'hex') // Get the input that spends an output
};

AddressService.MEMPREFIXES = {
  OUTPUTS: new Buffer('01', 'hex'), // Query mempool outputs by address
  SPENTS: new Buffer('02', 'hex'), // Query mempool inputs by address
  SPENTSMAP: new Buffer('03', 'hex') // Query mempool for the input that spends an output
};

// To save space, we're only storing the PubKeyHash or ScriptHash in our index.
// To avoid intentional unspendable collisions, which have been seen on the blockchain,
// we must store the hash type (PK or Script) as well.
AddressService.HASH_TYPES = {
  PUBKEY: new Buffer('01', 'hex'),
  REDEEMSCRIPT: new Buffer('02', 'hex')
};

// Translates from our enum type back into the hash types returned by
// bitcore-lib/address.
AddressService.HASH_TYPES_READABLE = {
  '01': 'pubkeyhash',
  '02': 'scripthash'
};

// Trnaslates from address types to our enum type.
AddressService.HASH_TYPES_MAP = {
  'pubkeyhash': AddressService.HASH_TYPES.PUBKEY,
  'scripthash': AddressService.HASH_TYPES.REDEEMSCRIPT
};

AddressService.SPACER_MIN = new Buffer('00', 'hex');
AddressService.SPACER_MAX = new Buffer('ff', 'hex');

AddressService.prototype.start = function(callback) {
  var self = this;

  async.series([
    function(next) {
      // Flush any existing mempool index
      if (fs.existsSync(self.mempoolIndexPath)) {
        leveldown.destroy(self.mempoolIndexPath, next);
      } else {
        setImmediate(next);
      }
    },
    function(next) {
      if (!fs.existsSync(self.mempoolIndexPath)) {
        mkdirp(self.mempoolIndexPath, next);
      } else {
        setImmediate(next);
      }
    },
    function(next) {
      self.mempoolIndex = levelup(
        self.mempoolIndexPath,
        {
          db: self.levelupStore,
          keyEncoding: 'binary',
          valueEncoding: 'binary',
          fillCache: false
        },
        next
      );
    }
  ], callback);

};

AddressService.prototype.stop = function(callback) {
  // TODO Keep track of ongoing db requests before shutting down
  this.mempoolIndex.close(callback);
};

/**
 * This function will set `this.dataPath` based on `this.node.network`.
 * @private
 */
AddressService.prototype._setMempoolIndexPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  var regtest = Networks.get('regtest');
  if (this.node.network === Networks.livenet) {
    this.mempoolIndexPath = this.node.datadir + '/bitcore-addressmempool.db';
  } else if (this.node.network === Networks.testnet) {
    this.mempoolIndexPath = this.node.datadir + '/testnet3/bitcore-addressmempool.db';
  } else if (this.node.network === regtest) {
    this.mempoolIndexPath = this.node.datadir + '/regtest/bitcore-addressmempool.db';
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

/**
 * Called by the Node to get the available API methods for this service,
 * that can be exposed over the JSON-RPC interface.
 */
AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['getInputForOutput', this, this.getInputForOutput, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
};

/**
 * Called by the Bus to get the available events for this service.
 */
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
 * This will handle data from the daemon "txleave" that a transaction has left the mempool.
 * @param {Object} txInfo - The data from the daemon.on('txleave') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {String} txInfo.hash - The hash of the transaction
 */
AddressService.prototype.transactionLeaveHandler = function(txInfo) {
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);
  this.updateMempoolIndex(tx, false);
};

/**
 * This will handle data from the daemon "tx" event, go through each of the outputs
 * and send messages by calling `transactionEventHandler` to any subscribers for a
 * particular address.
 * @param {Object} txInfo - The data from the daemon.on('tx') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {Boolean} txInfo.mempool - If the transaction was accepted in the mempool
 * @param {String} txInfo.hash - The hash of the transaction
 * @param {Function} [callback] - Optional callback
 */
AddressService.prototype.transactionHandler = function(txInfo, callback) {
  var self = this;

  // Basic transaction format is handled by the daemon
  // and we can safely assume the buffer is properly formatted.
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);

  var messages = {};

  var outputsLength = tx.outputs.length;
  for (var i = 0; i < outputsLength; i++) {
    this.transactionOutputHandler(messages, tx, i, !txInfo.mempool);
  }

  if (!callback) {
    callback = function(err) {
      if (err) {
        return log.error(err);
      }
    };
  }

  function finish(err) {
    if (err) {
      return callback(err);
    }
    for (var key in messages) {
      self.transactionEventHandler(messages[key]);
      self.balanceEventHandler(null, messages[key].addressInfo);
    }
    callback();
  }

  if (txInfo.mempool) {
    self.updateMempoolIndex(tx, true, finish);
  } else {
    setImmediate(finish);
  }

};

/**
 * This function will update the mempool address index with the necessary
 * information for further lookups.
 * @param {Transaction} - An instance of a Bitcore Transaction
 * @param {Boolean} - Add/remove from the index
 */
AddressService.prototype.updateMempoolIndex = function(tx, add, callback) {
  /* jshint maxstatements: 100 */

  var operations = [];

  var action = 'put';
  if (!add) {
    action = 'del';
  }

  var txid = tx.hash;
  var txidBuffer = new Buffer(txid, 'hex');

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

    // Update output index
    var outputIndexBuffer = new Buffer(4);
    outputIndexBuffer.writeUInt32BE(outputIndex);

    var outKey = Buffer.concat([
      AddressService.MEMPREFIXES.OUTPUTS,
      addressInfo.hashBuffer,
      addressInfo.hashTypeBuffer,
      txidBuffer,
      outputIndexBuffer
    ]);

    var outValue = this._encodeOutputValue(output.satoshis, output._scriptBuffer);

    operations.push({
      type: action,
      key: outKey,
      value: outValue
    });

  }
  var inputLength = tx.inputs.length;
  for (var inputIndex = 0; inputIndex < inputLength; inputIndex++) {

    var input = tx.inputs[inputIndex];

    var inputOutputIndexBuffer = new Buffer(4);
    inputOutputIndexBuffer.writeUInt32BE(input.outputIndex);

    // Add an additional small spent index for fast synchronous lookups
    var spentIndexSyncKey = this._encodeSpentIndexSyncKey(
      input.prevTxId,
      input.outputIndex
    );
    if (add) {
      this.mempoolSpentIndex[spentIndexSyncKey] = true;
    } else {
      delete this.mempoolSpentIndex[spentIndexSyncKey];
    }

    // Add a more detailed spent index with values
    var spentIndexKey = Buffer.concat([
      AddressService.MEMPREFIXES.SPENTSMAP,
      input.prevTxId,
      inputOutputIndexBuffer
    ]);
    var inputIndexBuffer = new Buffer(4);
    inputIndexBuffer.writeUInt32BE(inputIndex);
    var inputIndexValue = Buffer.concat([
      txidBuffer,
      inputIndexBuffer
    ]);
    operations.push({
      type: action,
      key: spentIndexKey,
      value: inputIndexValue
    });

    // Update input index
    var inputHashBuffer;
    var inputHashType;
    if (input.script.isPublicKeyHashIn()) {
      inputHashBuffer = Hash.sha256ripemd160(input.script.chunks[1].buf);
      inputHashType = AddressService.HASH_TYPES.PUBKEY;
    } else if (input.script.isScriptHashIn()) {
      inputHashBuffer = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
      inputHashType = AddressService.HASH_TYPES.REDEEMSCRIPT;
    } else {
      continue;
    }
    var inputKey = Buffer.concat([
      AddressService.MEMPREFIXES.SPENTS,
      inputHashBuffer,
      inputHashType,
      input.prevTxId,
      inputOutputIndexBuffer
    ]);
    var inputValue = Buffer.concat([
      txidBuffer,
      inputIndexBuffer
    ]);
    operations.push({
      type: action,
      key: inputKey,
      value: inputValue
    });

  }

  if (!callback) {
    callback = function(err) {
      if (err) {
        return log.error(err);
      }
    };
  }

  this.mempoolIndex.batch(operations, callback);
};

/**
 * This function is optimized to return address information about an output script
 * without constructing a Bitcore Address instance.
 * @param {Script} - An instance of a Bitcore Script
 * @private
 */
AddressService.prototype._extractAddressInfoFromScript = function(script) {
  var hashBuffer;
  var addressType;
  var hashTypeBuffer;
  if (script.isPublicKeyHashOut()) {
    hashBuffer = script.chunks[2].buf;
    hashTypeBuffer = AddressService.HASH_TYPES.PUBKEY;
    addressType = Address.PayToPublicKeyHash;
  } else if (script.isScriptHashOut()) {
    hashBuffer = script.chunks[1].buf;
    hashTypeBuffer = AddressService.HASH_TYPES.REDEEMSCRIPT;
    addressType = Address.PayToScriptHash;
  } else if (script.isPublicKeyOut()) {
    var pubkey = script.chunks[0].buf;
    var address = Address.fromPublicKey(new PublicKey(pubkey), this.node.network);
    hashBuffer = address.hashBuffer;
    hashTypeBuffer = AddressService.HASH_TYPES.PUBKEY;
    // pay-to-publickey doesn't have an address, however for compatibility
    // purposes, we can create an address
    addressType = Address.PayToPublicKeyHash;
  } else {
    return false;
  }
  return {
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    addressType: addressType
  };
};

/**
 * The Database Service will run this function when blocks are connected and
 * disconnected to the chain during syncing and reorganizations.
 * @param {Block} block - An instance of a Bitcore Block
 * @param {Boolean} addOutput - If the block is being removed or added to the chain
 * @param {Function} callback
 */
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
    var txidBuffer = new Buffer(txid, 'hex');
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
      var key = this._encodeOutputKey(addressInfo.hashBuffer, addressInfo.hashTypeBuffer,
                                      height, txidBuffer, outputIndex);
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
      var inputHashType;

      if (input.script.isPublicKeyHashIn()) {
        inputHash = Hash.sha256ripemd160(input.script.chunks[1].buf);
        inputHashType = AddressService.HASH_TYPES.PUBKEY;
      } else if (input.script.isScriptHashIn()) {
        inputHash = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
        inputHashType = AddressService.HASH_TYPES.REDEEMSCRIPT;
      } else {
        continue;
      }

      var prevTxIdBuffer = new Buffer(input.prevTxId, 'hex');

      // To be able to query inputs by address and spent height
      var inputKey = this._encodeInputKey(inputHash, inputHashType, height, prevTxIdBuffer, input.outputIndex);
      var inputValue = this._encodeInputValue(txidBuffer, inputIndex);

      operations.push({
        type: action,
        key: inputKey,
        value: inputValue
      });

      // To be able to search for an input spending an output
      var inputKeyMap = this._encodeInputKeyMap(prevTxIdBuffer, input.outputIndex);
      var inputValueMap = this._encodeInputValueMap(txidBuffer, inputIndex);

      operations.push({
        type: action,
        key: inputKeyMap,
        value: inputValueMap
      });

    }
  }

  setImmediate(function() {
    callback(null, operations);
  });
};

AddressService.prototype._encodeSpentIndexSyncKey = function(txidBuffer, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var key = Buffer.concat([
    txidBuffer,
    outputIndexBuffer
  ]);
  return key.toString('binary');
};

AddressService.prototype._encodeOutputKey = function(hashBuffer, hashTypeBuffer, height, txidBuffer, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var key = Buffer.concat([
    AddressService.PREFIXES.OUTPUTS,
    hashBuffer,
    hashTypeBuffer,
    AddressService.SPACER_MIN,
    heightBuffer,
    txidBuffer,
    outputIndexBuffer
  ]);
  return key;
};

AddressService.prototype._decodeOutputKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(1);
  var hashBuffer = reader.read(20);
  var hashTypeBuffer = reader.read(1);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var txid = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
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

AddressService.prototype._encodeInputKey = function(hashBuffer, hashTypeBuffer, height, prevTxIdBuffer, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([
    AddressService.PREFIXES.SPENTS,
    hashBuffer,
    hashTypeBuffer,
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
  var hashTypeBuffer = reader.read(1);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var prevTxId = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    height: height,
    prevTxId: prevTxId,
    outputIndex: outputIndex
  };
};

AddressService.prototype._encodeInputValue = function(txidBuffer, inputIndex) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  return Buffer.concat([
    txidBuffer,
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

AddressService.prototype._encodeInputKeyMap = function(outputTxIdBuffer, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([
    AddressService.PREFIXES.SPENTSMAP,
    outputTxIdBuffer,
    outputIndexBuffer
  ]);
};

AddressService.prototype._decodeInputKeyMap = function(buffer) {
  var txid = buffer.slice(1, 33);
  var outputIndex = buffer.readUInt32BE(33);
  return {
    outputTxId: txid,
    outputIndex: outputIndex
  };
};

AddressService.prototype._encodeInputValueMap = function(inputTxIdBuffer, inputIndex) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  return Buffer.concat([
    inputTxIdBuffer,
    inputIndexBuffer
  ]);
};

AddressService.prototype._decodeInputValueMap = function(buffer) {
  var txid = buffer.slice(0, 32);
  var inputIndex = buffer.readUInt32BE(32);
  return {
    inputTxId: txid,
    inputIndex: inputIndex
  };
};

AddressService.prototype._getAddressInfo = function(addressStr) {
  var addrObj = bitcore.Address(addressStr);
  var hashTypeBuffer = AddressService.HASH_TYPES_MAP[addrObj.type];

  return {
    hashBuffer: addrObj.hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    hashTypeReadable: addrObj.type
  };
};

/**
 * This function is responsible for emitting events to any subscribers to the
 * `address/transaction` event.
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
 * The function is responsible for emitting events to any subscribers for the
 * `address/balance` event.
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

/**
 * The Bus will use this function to subscribe to the available
 * events for this service. For information about the available events
 * please see `getPublishEvents`.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An event emitter instance
 * @param {Array} addresses - An array of addresses to subscribe
 */
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

/**
 * The Bus will use this function to unsubscribe to the available
 * events for this service.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An event emitter instance
 * @param {Array} addresses - An array of addresses to subscribe
 */
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

/**
 * A helper function for the `unsubscribe` method to unsubscribe from all addresses.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An instance of an event emitter
 */
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

/**
 * Will sum the total of all unspent outputs to calculate the balance
 * for an address.
 * @param {String} address - The base58check encoded address
 * @param {Boolean} queryMempool - Include mempool in the results
 * @param {Function} callback
 */
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
 * Will give the input that spends an output if it exists with:
 *   inputTxId - The input txid hex string
 *   inputIndex - A number with the spending input index
 * @param {String|Buffer} txid - The transaction hash with the output
 * @param {Number} outputIndex - The output index in the transaction
 * @param {Object} options
 * @param {Object} options.queryMempool - Include mempool in results
 * @param {Function} callback
 */
AddressService.prototype.getInputForOutput = function(txid, outputIndex, options, callback) {
  $.checkArgument(_.isNumber(outputIndex));
  $.checkArgument(_.isObject(options));
  $.checkArgument(_.isFunction(callback));
  var self = this;
  var txidBuffer;
  if (Buffer.isBuffer(txid)) {
    txidBuffer = txid;
  } else {
    txidBuffer = new Buffer(txid, 'hex');
  }
  if (options.queryMempool) {
    var spentIndexSyncKey = this._encodeSpentIndexSyncKey(txidBuffer, outputIndex);
    if (this.mempoolSpentIndex[spentIndexSyncKey]) {
      return this._getSpentMempool(txidBuffer, outputIndex, callback);
    }
  }
  var key = this._encodeInputKeyMap(txidBuffer, outputIndex);
  var dbOptions = {
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  };
  this.node.services.db.store.get(key, dbOptions, function(err, buffer) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback(null, false);
    } else if (err) {
      return callback(err);
    }
    var value = self._decodeInputValueMap(buffer);
    callback(null, {
      inputTxId: value.inputTxId.toString('hex'),
      inputIndex: value.inputIndex
    });
  });
};

/**
 * Will give inputs that spend previous outputs for an address as an object with:
 *   address - The base58check encoded address
 *   hashType - The type of the address, e.g. 'pubkeyhash' or 'scripthash'
 *   txid - A string of the transaction hash
 *   outputIndex - A number of corresponding transaction input
 *   height - The height of the block the transaction was included, will be -1 for mempool transactions
 *   confirmations - The number of confirmations, will equal 0 for mempool transactions
 *
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

  var addrObj = this._getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;
  if (!hashTypeBuffer) {
    return callback(new Error('Unknown address type: ' + addrObj.hashTypeReadable + ' for address: ' + addressStr));
  }

  if (options.start && options.end) {

    var endBuffer = new Buffer(4);
    endBuffer.writeUInt32BE(options.end);

    var startBuffer = new Buffer(4);
    startBuffer.writeUInt32BE(options.start + 1);

    stream = this.node.services.db.store.createReadStream({
      gte: Buffer.concat([
        AddressService.PREFIXES.SPENTS,
        hashBuffer,
        hashTypeBuffer,
        AddressService.SPACER_MIN,
        endBuffer
      ]),
      lte: Buffer.concat([
        AddressService.PREFIXES.SPENTS,
        hashBuffer,
        hashTypeBuffer,
        AddressService.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer, hashTypeBuffer]);
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
      hashType: addrObj.hashTypeReadable,
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
      self._getInputsMempool(addressStr, hashBuffer, hashTypeBuffer, function(err, mempoolInputs) {
        if (err) {
          return callback(err);
        }
        inputs = inputs.concat(mempoolInputs);
        callback(null, inputs);
      });
    } else {
      callback(null, inputs);
    }

  });

  return stream;

};

AddressService.prototype._getInputsMempool = function(addressStr, hashBuffer, hashTypeBuffer, callback) {
  var self = this;
  var mempoolInputs = [];

  var stream = self.mempoolIndex.createReadStream({
    gte: Buffer.concat([
      AddressService.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      AddressService.SPACER_MIN
    ]),
    lte: Buffer.concat([
      AddressService.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      AddressService.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    var txid = data.value.slice(0, 32);
    var inputIndex = data.value.readUInt32BE(32);
    var output = {
      address: addressStr,
      hashType: AddressService.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      inputIndex: inputIndex,
      height: -1,
      confirmations: 0
    };
    mempoolInputs.push(output);
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
    callback(null, mempoolInputs);
  });

};

AddressService.prototype._getSpentMempool = function(txidBuffer, outputIndex, callback) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var spentIndexKey = Buffer.concat([
    AddressService.MEMPREFIXES.SPENTSMAP,
    txidBuffer,
    outputIndexBuffer
  ]);

  this.mempoolIndex.get(
    spentIndexKey,
    function(err, mempoolValue) {
      if (err) {
        return callback(err);
      }
      var inputTxId = mempoolValue.slice(0, 32);
      var inputIndex = mempoolValue.readUInt32BE(32);
      callback(null, {
        inputTxId: inputTxId.toString('hex'),
        inputIndex: inputIndex
      });
    }
  );
};

/**
 * Will give outputs for an address as an object with:
 *   address - The base58check encoded address
 *   hashType - The type of the address, e.g. 'pubkeyhash' or 'scripthash'
 *   txid - A string of the transaction hash
 *   outputIndex - A number of corresponding transaction output
 *   height - The height of the block the transaction was included, will be -1 for mempool transactions
 *   satoshis - The satoshis value of the output
 *   script - The script of the output as a hex string
 *   confirmations - The number of confirmations, will equal 0 for mempool transactions
 *
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

  var addrObj = this._getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;
  if (!hashTypeBuffer) {
    return callback(new Error('Unknown address type: ' + addrObj.hashTypeReadable + ' for address: ' + addressStr));
  }

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
        hashTypeBuffer,
        AddressService.SPACER_MIN,
        endBuffer
      ]),
      lte: Buffer.concat([
        AddressService.PREFIXES.OUTPUTS,
        hashBuffer,
        hashTypeBuffer,
        AddressService.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([AddressService.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer]);
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
      hashType: addrObj.hashTypeReadable,
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
      self._getOutputsMempool(addressStr, hashBuffer, hashTypeBuffer, function(err, mempoolOutputs) {
        if (err) {
          return callback(err);
        }
        outputs = outputs.concat(mempoolOutputs);
        callback(null, outputs);
      });
    } else {
      callback(null, outputs);
    }
  });

  return stream;

};

AddressService.prototype._getOutputsMempool = function(addressStr, hashBuffer, hashTypeBuffer, callback) {
  var self = this;
  var mempoolOutputs = [];

  var stream = self.mempoolIndex.createReadStream({
    gte: Buffer.concat([
      AddressService.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      AddressService.SPACER_MIN
    ]),
    lte: Buffer.concat([
      AddressService.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      AddressService.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    // Format of data: prefix: 1, hashBuffer: 20, hashTypeBuffer: 1, txid: 32, outputIndex: 4
    var txid = data.key.slice(22, 54);
    var outputIndex = data.key.readUInt32BE(54);
    var value = self._decodeOutputValue(data.value);
    var output = {
      address: addressStr,
      hashType: AddressService.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      outputIndex: outputIndex,
      height: -1,
      satoshis: value.satoshis,
      script: value.scriptBuffer.toString('hex'), //TODO use a buffer
      confirmations: 0
    };
    mempoolOutputs.push(output);
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
    callback(null, mempoolOutputs);
  });

};

/**
 * Will give unspent outputs for an address or an array of addresses.
 * @param {Array|String} addresses - An array of addresses
 * @param {Boolean} queryMempool - Include or exclude the mempool
 * @param {Function} callback
 */
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

/**
 * Will give unspent outputs for an address.
 * @param {String} address - An address in base58check encoding
 * @param {Boolean} queryMempool - Include or exclude the mempool
 * @param {Function} callback
 */
AddressService.prototype.getUnspentOutputsForAddress = function(address, queryMempool, callback) {

  var self = this;

  this.getOutputs(address, {queryMempool: queryMempool}, function(err, outputs) {
    if (err) {
      return callback(err);
    } else if(!outputs.length) {
      return callback(new errors.NoOutputs('Address ' + address + ' has no outputs'), []);
    }

    var opts = {
      queryMempool: queryMempool
    };

    var isUnspent = function(output, callback) {
      self.isUnspent(output, opts, callback);
    };

    async.filter(outputs, isUnspent, function(results) {
      callback(null, results);
    });
  });
};

/**
 * Will give the inverse of isSpent
 * @param {Object} output
 * @param {Object} options
 * @param {Boolean} options.queryMempool - Include mempool in results
 * @param {Function} callback
 */
AddressService.prototype.isUnspent = function(output, options, callback) {
  $.checkArgument(_.isFunction(callback));
  this.isSpent(output, options, function(spent) {
    callback(!spent);
  });
};

/**
 * Will determine if an output is spent.
 * @param {Object} output - An output as returned from getOutputs
 * @param {Object} options
 * @param {Boolean} options.queryMempool - Include mempool in results
 * @param {Function} callback
 */
AddressService.prototype.isSpent = function(output, options, callback) {
  $.checkArgument(_.isFunction(callback));
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var self = this;
  var txid = output.prevTxId ? output.prevTxId.toString('hex') : output.txid;
  var spent = self.node.services.bitcoind.isSpent(txid, output.outputIndex);
  if (!spent && queryMempool) {
    var txidBuffer = new Buffer(txid, 'hex');
    var spentIndexSyncKey = this._encodeSpentIndexSyncKey(txidBuffer, output.outputIndex);
    spent = self.mempoolSpentIndex[spentIndexSyncKey] ? true : false;
  }
  setImmediate(function() {
    // TODO error should be the first argument?
    callback(spent);
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
 * This will give an object with:
 *   balance - confirmed balance
 *   unconfirmedBalance - unconfirmed balance
 *   totalReceived - satoshis received
 *   totalSpent - satoshis spent
 *   appearances - number of transactions
 *   unconfirmedAppearances - number of unconfirmed transactions
 *   txids - list of txids (unless noTxList is set)
 *
 * @param {String} address
 * @param {Object} options
 * @param {Boolean} [options.noTxList] - if set, txid array will not be included
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
        // Bitcoind's isSpent only works for confirmed transactions
        var spentDB = self.node.services.bitcoind.isSpent(outputs[i].txid, outputs[i].outputIndex);
        var spentIndexSyncKey = self._encodeSpentIndexSyncKey(
          new Buffer(outputs[i].txid, 'hex'), // TODO: get buffer directly
          outputs[i].outputIndex
        );
        var spentMempool = self.mempoolSpentIndex[spentIndexSyncKey];

        txids.push(outputs[i]);

        if(outputs[i].confirmations) {
          totalReceived += outputs[i].satoshis;
          balance += outputs[i].satoshis;
          appearanceIds[outputs[i].txid] = true;
        } else {
          unconfirmedAppearanceIds[outputs[i].txid] = true;
        }
        unconfirmedBalance += outputs[i].satoshis;

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
