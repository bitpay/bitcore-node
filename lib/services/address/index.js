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
var EventEmitter = require('events').EventEmitter;
var Address = bitcore.Address;
var AddressHistory = require('./history');
var constants = require('./constants');
var encoding = require('./encoding');
var InputsTransformStream = require('./streams/inputs-transform');
var OutputsTransformStream = require('./streams/outputs-transform');


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

  this.maxInputsQueryLength = options.maxInputsQueryLength || constants.MAX_INPUTS_QUERY_LENGTH;
  this.maxOutputsQueryLength = options.maxOutputsQueryLength || constants.MAX_OUTPUTS_QUERY_LENGTH;

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
      // Setup new mempool index
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
          fillCache: false,
          maxOpenFiles: 200
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
 * This function will set `this.mempoolIndexPath` based on `this.node.network`.
 * @private
 */
AddressService.prototype._setMempoolIndexPath = function() {
  this.mempoolIndexPath = this._getDBPathFor('bitcore-addressmempool.db');
};

AddressService.prototype._getDBPathFor = function(dbname) {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  var path;
  var regtest = Networks.get('regtest');
  if (this.node.network === Networks.livenet) {
    path = this.node.datadir + '/' + dbname;
  } else if (this.node.network === Networks.testnet) {
    path = this.node.datadir + '/testnet3/' + dbname;
  } else if (this.node.network === regtest) {
    path = this.node.datadir + '/regtest/' + dbname;
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
  return path;
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

  var addressInfo = encoding.extractAddressInfoFromScript(script, this.node.network);
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
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(new Date().getTime());

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
    var addressInfo = encoding.extractAddressInfoFromScript(output.script, this.node.network);
    if (!addressInfo) {
      continue;
    }

    // Update output index
    var outputIndexBuffer = new Buffer(4);
    outputIndexBuffer.writeUInt32BE(outputIndex);

    var outKey = Buffer.concat([
      constants.MEMPREFIXES.OUTPUTS,
      addressInfo.hashBuffer,
      addressInfo.hashTypeBuffer,
      txidBuffer,
      outputIndexBuffer
    ]);

    var outValue = encoding.encodeOutputMempoolValue(
      output.satoshis,
      timestampBuffer,
      output._scriptBuffer
    );

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
    var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(
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
      constants.MEMPREFIXES.SPENTSMAP,
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
      inputHashType = constants.HASH_TYPES.PUBKEY;
    } else if (input.script.isScriptHashIn()) {
      inputHashBuffer = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
      inputHashType = constants.HASH_TYPES.REDEEMSCRIPT;
    } else {
      continue;
    }
    var inputKey = Buffer.concat([
      constants.MEMPREFIXES.SPENTS,
      inputHashBuffer,
      inputHashType,
      input.prevTxId,
      inputOutputIndexBuffer
    ]);
    var inputValue = Buffer.concat([
      txidBuffer,
      inputIndexBuffer,
      timestampBuffer
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

      var addressInfo = encoding.extractAddressInfoFromScript(script, this.node.network);
      if (!addressInfo) {
        continue;
      }

      // We need to use the height for indexes (and not the timestamp) because the
      // the timestamp has unreliable sequential ordering. The next block
      // can have a time that is previous to the previous block (however not
      // less than the mean of the 11 previous blocks) and not greater than 2
      // hours in the future.
      var key = encoding.encodeOutputKey(addressInfo.hashBuffer, addressInfo.hashTypeBuffer,
                                         height, txidBuffer, outputIndex);
      var value = encoding.encodeOutputValue(output.satoshis, output._scriptBuffer);
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
        inputHashType = constants.HASH_TYPES.PUBKEY;
      } else if (input.script.isScriptHashIn()) {
        inputHash = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
        inputHashType = constants.HASH_TYPES.REDEEMSCRIPT;
      } else {
        continue;
      }

      var prevTxIdBuffer = new Buffer(input.prevTxId, 'hex');

      // To be able to query inputs by address and spent height
      var inputKey = encoding.encodeInputKey(inputHash, inputHashType, height, prevTxIdBuffer, input.outputIndex);
      var inputValue = encoding.encodeInputValue(txidBuffer, inputIndex);

      operations.push({
        type: action,
        key: inputKey,
        value: inputValue
      });

      // To be able to search for an input spending an output
      var inputKeyMap = encoding.encodeInputKeyMap(prevTxIdBuffer, input.outputIndex);
      var inputValueMap = encoding.encodeInputValueMap(txidBuffer, inputIndex);

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
    var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(txidBuffer, outputIndex);
    if (this.mempoolSpentIndex[spentIndexSyncKey]) {
      return this._getSpentMempool(txidBuffer, outputIndex, callback);
    }
  }
  var key = encoding.encodeInputKeyMap(txidBuffer, outputIndex);
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
    var value = encoding.decodeInputValueMap(buffer);
    callback(null, {
      inputTxId: value.inputTxId.toString('hex'),
      inputIndex: value.inputIndex
    });
  });
};

/**
 * A streaming equivalent to `getInputs`, and returns a transform stream with data
 * emitted in the same format as `getInputs`.
 *
 * @param {String} addressStr - The relevant address
 * @param {Object} options - Additional options for query the outputs
 * @param {Number} [options.start] - The relevant start block height
 * @param {Number} [options.end] - The relevant end block height
 * @param {Function} callback
 */
AddressService.prototype.createInputsStream = function(addressStr, options) {
  var inputStream = new InputsTransformStream({
    address: new Address(addressStr, this.node.network),
    tipHeight: this.node.services.db.tip.__height
  });

  var stream = this.createInputsDBStream(addressStr, options)
    .on('error', function(err) {
      // Forward the error
      inputStream.emit('error', err);
      inputStream.end();
    }).pipe(inputStream);


  inputStream.on('end', function() {
    stream.end();
  });

  return stream;

};

AddressService.prototype.createInputsDBStream = function(addressStr, options) {
  var stream;
  var addrObj = encoding.getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;

  if (options.start >= 0 && options.end >= 0) {

    var endBuffer = new Buffer(4);
    endBuffer.writeUInt32BE(options.end, 0);

    var startBuffer = new Buffer(4);
    // Because the key has additional data following it, we don't have an ability
    // to use "gte" or "lte" we can only use "gt" and "lt", we therefore need to adjust the number
    // to be one value larger to include it.
    var adjustedStart = options.start + 1;
    startBuffer.writeUInt32BE(adjustedStart, 0);

    stream = this.node.services.db.store.createReadStream({
      gt: Buffer.concat([
        constants.PREFIXES.SPENTS,
        hashBuffer,
        hashTypeBuffer,
        constants.SPACER_MIN,
        endBuffer
      ]),
      lt: Buffer.concat([
        constants.PREFIXES.SPENTS,
        hashBuffer,
        hashTypeBuffer,
        constants.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([constants.PREFIXES.SPENTS, hashBuffer, hashTypeBuffer]);
    stream = this.node.services.db.store.createReadStream({
      gt: Buffer.concat([allKey, constants.SPACER_HEIGHT_MIN]),
      lt: Buffer.concat([allKey, constants.SPACER_HEIGHT_MAX]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  }

  return stream;
};

/**
 * Will give inputs that spend previous outputs for an address as an object with:
 *   address - The base58check encoded address
 *   hashtype - The type of the address, e.g. 'pubkeyhash' or 'scripthash'
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

  var addrObj = encoding.getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;

  var stream = this.createInputsStream(addressStr, options);

  stream.on('data', function(input) {
    inputs.push(input);
    if (inputs.length > self.maxInputsQueryLength) {
      log.warn('Tried to query too many inputs (' + self.maxInputsQueryLength + ') for address '+ addressStr);
      error = new Error('Maximum number of inputs (' + self.maxInputsQueryLength + ') per query reached');
      stream.pause();
      stream.end();
    }
  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('finish', function() {
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
      constants.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MIN
    ]),
    lte: Buffer.concat([
      constants.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    var txid = data.value.slice(0, 32);
    var inputIndex = data.value.readUInt32BE(32);
    var timestamp = data.value.readDoubleBE(36);
    var input = {
      address: addressStr,
      hashType: constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      inputIndex: inputIndex,
      timestamp: timestamp,
      height: -1,
      confirmations: 0
    };
    mempoolInputs.push(input);
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
    constants.MEMPREFIXES.SPENTSMAP,
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

AddressService.prototype.createOutputsStream = function(addressStr, options) {

  var outputStream = new OutputsTransformStream({
    address: new Address(addressStr, this.node.network),
    tipHeight: this.node.services.db.tip.__height
  });

  var stream = this.createOutputsDBStream(addressStr, options)
    .on('error', function(err) {
      // Forward the error
      outputStream.emit('error', err);
      outputStream.end();
    })
    .pipe(outputStream);

  outputStream.on('end', function() {
    stream.end();
  });

  return stream;

};

AddressService.prototype.createOutputsDBStream = function(addressStr, options) {

  var addrObj = encoding.getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;
  var stream;

  if (options.start >= 0 && options.end >= 0) {

    var endBuffer = new Buffer(4);
    endBuffer.writeUInt32BE(options.end, 0);

    var startBuffer = new Buffer(4);
    // Because the key has additional data following it, we don't have an ability
    // to use "gte" or "lte" we can only use "gt" and "lt", we therefore need to adjust the number
    // to be one value larger to include it.
    var startAdjusted = options.start + 1;
    startBuffer.writeUInt32BE(startAdjusted, 0);

    stream = this.node.services.db.store.createReadStream({
      gt: Buffer.concat([
        constants.PREFIXES.OUTPUTS,
        hashBuffer,
        hashTypeBuffer,
        constants.SPACER_MIN,
        endBuffer
      ]),
      lt: Buffer.concat([
        constants.PREFIXES.OUTPUTS,
        hashBuffer,
        hashTypeBuffer,
        constants.SPACER_MIN,
        startBuffer
      ]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  } else {
    var allKey = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer]);
    stream = this.node.services.db.store.createReadStream({
      gt: Buffer.concat([allKey, constants.SPACER_HEIGHT_MIN]),
      lt: Buffer.concat([allKey, constants.SPACER_HEIGHT_MAX]),
      valueEncoding: 'binary',
      keyEncoding: 'binary'
    });
  }

  return stream;

};

/**
 * Will give outputs for an address as an object with:
 *   address - The base58check encoded address
 *   hashtype - The type of the address, e.g. 'pubkeyhash' or 'scripthash'
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

  var addrObj = encoding.getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;
  if (!hashTypeBuffer) {
    return callback(new Error('Unknown address type: ' + addrObj.hashTypeReadable + ' for address: ' + addressStr));
  }

  var outputs = [];
  var stream = this.createOutputsStream(addressStr, options);

  stream.on('data', function(data) {
    outputs.push(data);
    if (outputs.length > self.maxOutputsQueryLength) {
      log.warn('Tried to query too many outputs (' + self.maxOutputsQueryLength + ') for address ' + addressStr);
      error = new Error('Maximum number of outputs (' + self.maxOutputsQueryLength + ') per query reached');
      stream.pause();
      stream.end();
    }
  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('finish', function() {
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
      constants.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MIN
    ]),
    lte: Buffer.concat([
      constants.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    // Format of data:
    // prefix: 1, hashBuffer: 20, hashTypeBuffer: 1, txid: 32, outputIndex: 4
    var txid = data.key.slice(22, 54);
    var outputIndex = data.key.readUInt32BE(54);
    var value = encoding.decodeOutputMempoolValue(data.value);
    var output = {
      address: addressStr,
      hashType: constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      outputIndex: outputIndex,
      height: -1,
      timestamp: value.timestamp,
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
    var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(txidBuffer, output.outputIndex);
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
AddressService.prototype.getAddressSummary = function(addressArg, options, callback) {
  var self = this;

  var startTime = new Date();
  var address = new Address(addressArg);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  async.waterfall([
    function(next) {
      self._getAddressConfirmedSummary(address, options, next);
    },
    function(result, next) {
      self._getAddressMempoolSummary(address, options, result, next);
    }
  ], function(err, result) {
    if (err) {
      return callback(err);
    }

    var summary = self._transformAddressSummaryFromResult(result, options);

    var timeDelta = new Date() - startTime;
    if (timeDelta > 5000) {
      var seconds = Math.round(timeDelta / 1000);
      log.warn('Slow (' + seconds + 's) getAddressSummary request for address: ' + address.toString());
    }

    callback(null, summary);

  });

};

AddressService.prototype._getAddressConfirmedSummary = function(address, options, callback) {
  var self = this;
  var baseResult = {
    appearanceIds: {},
    totalReceived: 0,
    balance: 0,
    unconfirmedAppearanceIds: {},
    unconfirmedBalance: 0
  };

  async.waterfall([
    function(next) {
      self._getAddressConfirmedInputsSummary(address, baseResult, options, next);
    },
    function(result, next) {
      self._getAddressConfirmedOutputsSummary(address, result, options, next);
    },
    function(result, next) {
      self._setAndSortTxidsFromAppearanceIds(result, next);
    }
  ], callback);

};

AddressService.prototype._getAddressConfirmedInputsSummary = function(address, result, options, callback) {
  $.checkArgument(address instanceof Address);
  var self = this;
  var error = null;
  var count = 0;

  var inputsStream = self.createInputsStream(address, options);
  inputsStream.on('data', function(input) {
    var txid = input.txid;
    result.appearanceIds[txid] = input.height;

    count++;

    if (count > self.maxInputsQueryLength) {
      log.warn('Tried to query too many inputs (' + self.maxInputsQueryLength + ') for summary of address ' + address.toString());
      error = new Error('Maximum number of inputs (' + self.maxInputsQueryLength + ') per query reached');
      inputsStream.pause();
      inputsStream.end();
    }

  });

  inputsStream.on('error', function(err) {
    error = err;
  });

  inputsStream.on('end', function() {
    if (error) {
      return callback(error);
    }
    callback(null, result);
  });
};

AddressService.prototype._getAddressConfirmedOutputsSummary = function(address, result, options, callback) {
  $.checkArgument(address instanceof Address);
  $.checkArgument(!_.isUndefined(result) &&
                  !_.isUndefined(result.appearanceIds) &&
                  !_.isUndefined(result.unconfirmedAppearanceIds));

  var self = this;
  var count = 0;

  var outputStream = self.createOutputsStream(address, options);

  outputStream.on('data', function(output) {

    var txid = output.txid;
    var outputIndex = output.outputIndex;

    // Bitcoind's isSpent only works for confirmed transactions
    var spentDB = self.node.services.bitcoind.isSpent(txid, outputIndex);
    result.totalReceived += output.satoshis;
    result.appearanceIds[txid] = output.height;

    if (!spentDB) {
      result.balance += output.satoshis;
    }

    if (options.queryMempool) {
      // Check to see if this output is spent in the mempool and if so
      // we will subtract it from the unconfirmedBalance (a.k.a unconfirmedDelta)
      var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(
        new Buffer(txid, 'hex'), // TODO: get buffer directly
        outputIndex
      );
      var spentMempool = self.mempoolSpentIndex[spentIndexSyncKey];
      if (spentMempool) {
        result.unconfirmedBalance -= output.satoshis;
      }
    }

    count++;

    if (count > self.maxOutputsQueryLength) {
      log.warn('Tried to query too many outputs (' + self.maxOutputsQueryLength + ') for summary of address ' + address.toString());
      error = new Error('Maximum number of outputs (' + self.maxOutputsQueryLength + ') per query reached');
      outputStream.pause();
      outputStream.end();
    }

  });

  var error = null;

  outputStream.on('error', function(err) {
    error = err;
  });

  outputStream.on('end', function() {
    if (error) {
      return callback(error);
    }
    callback(null, result);
  });

};

AddressService.prototype._setAndSortTxidsFromAppearanceIds = function(result, callback) {
  result.txids = Object.keys(result.appearanceIds);
  result.txids.sort(function(a, b) {
    return result.appearanceIds[a] - result.appearanceIds[b];
  });
  callback(null, result);
};

AddressService.prototype._getAddressMempoolSummary = function(address, options, result, callback) {
  var self = this;

  // Skip if the options do not want to include the mempool
  if (!options.queryMempool) {
    return callback(null, result);
  }

  var addressStr = address.toString();
  var hashBuffer = address.hashBuffer;
  var hashTypeBuffer = constants.HASH_TYPES_MAP[address.type];

  async.waterfall([
    function(next) {
      self._getInputsMempool(addressStr, hashBuffer, hashTypeBuffer, function(err, mempoolInputs) {
        if (err) {
          return next(err);
        }
        for(var i = 0; i < mempoolInputs.length; i++) {
          var input = mempoolInputs[i];
          result.unconfirmedAppearanceIds[input.txid] = input.timestamp;
        }
        next(null, result);
      });

    }, function(result, next) {
      self._getOutputsMempool(addressStr, hashBuffer, hashTypeBuffer, function(err, mempoolOutputs) {
        if (err) {
          return next(err);
        }
        for(var i = 0; i < mempoolOutputs.length; i++) {
          var output = mempoolOutputs[i];

          result.unconfirmedAppearanceIds[output.txid] = output.timestamp;

          var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(
            new Buffer(output.txid, 'hex'), // TODO: get buffer directly
            output.outputIndex
          );
          var spentMempool = self.mempoolSpentIndex[spentIndexSyncKey];
          // Only add this to the balance if it's not spent in the mempool already
          if (!spentMempool) {
            result.unconfirmedBalance += output.satoshis;
          }
        }
        next(null, result);
      });
    }
  ], callback);
};

AddressService.prototype._transformAddressSummaryFromResult = function(result, options) {

  var confirmedTxids = result.txids;
  var unconfirmedTxids = Object.keys(result.unconfirmedAppearanceIds);

  var summary = {
    totalReceived: result.totalReceived,
    totalSpent: result.totalReceived - result.balance,
    balance: result.balance,
    appearances: confirmedTxids.length,
    unconfirmedBalance: result.unconfirmedBalance,
    unconfirmedAppearances: unconfirmedTxids.length
  };

  if (options.fullTxList) {
    summary.appearanceIds = result.appearanceIds;
    summary.unconfirmedAppearanceIds = result.unconfirmedAppearanceIds;
  } else if (!options.noTxList) {
    summary.txids = confirmedTxids.concat(unconfirmedTxids);
  }

  return summary;

};

module.exports = AddressService;
