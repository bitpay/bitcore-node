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
var Encoding = require('./encoding');
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

  // this.subscriptions = {};
  // this.subscriptions['address/transaction'] = {};
  // this.subscriptions['address/balance'] = {};

  // this._bitcoindTransactionListener = this.transactionHandler.bind(this);
  // this._bitcoindTransactionLeaveListener = this.transactionLeaveHandler.bind(this);
  // this.node.services.bitcoind.on('tx', this._bitcoindTransactionListener);
  // this.node.services.bitcoind.on('txleave', this._bitcoindTransactionLeaveListener);

  this.maxInputsQueryLength = options.maxInputsQueryLength || constants.MAX_INPUTS_QUERY_LENGTH;
  this.maxOutputsQueryLength = options.maxOutputsQueryLength || constants.MAX_OUTPUTS_QUERY_LENGTH;

  this.concurrency = options.concurrency || 20;

  // this.mempoolIndex = null; // Used for larger mempool indexes
  // this.mempoolSpentIndex = {}; // Used for small quick synchronous lookups
  // this.mempoolAddressIndex = {}; // Used to check if an address is on the spend pool
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db',
  'transaction'
];

AddressService.prototype.start = function(callback) {
  var self = this;

  this.store = this.node.services.db.store;

  this.node.services.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }

    self.prefix = prefix;

    self.encoding = new Encoding(self.prefix);

    callback();
  });
};

AddressService.prototype.stop = function(callback) {
  // TODO Keep track of ongoing db requests before shutting down
  // this.node.services.bitcoind.removeListener('tx', this._bitcoindTransactionListener);
  // this.node.services.bitcoind.removeListener('txleave', this._bitcoindTransactionLeaveListener);
  // this.mempoolIndex.close(callback);
  setImmediate(callback);
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
  return [];
  // return [
  //   {
  //     name: 'address/transaction',
  //     scope: this,
  //     subscribe: this.subscribe.bind(this, 'address/transaction'),
  //     unsubscribe: this.unsubscribe.bind(this, 'address/transaction')
  //   },
  //   {
  //     name: 'address/balance',
  //     scope: this,
  //     subscribe: this.subscribe.bind(this, 'address/balance'),
  //     unsubscribe: this.unsubscribe.bind(this, 'address/balance')
  //   }
  // ];
};

/**
 * The Database Service will run this function when blocks are connected and
 * disconnected to the chain during syncing and reorganizations.
 * @param {Block} block - An instance of a Bitcore Block
 * @param {Boolean} addOutput - If the block is being removed or added to the chain
 * @param {Function} callback
 */
AddressService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  var txs = block.transactions;
  var height = block.__height;

  var action = 'put';
  var reverseAction = 'del';
  if (!connectBlock) {
    action = 'del';
    reverseAction = 'put';
  }

  var operations = [];

  var transactionLength = txs.length;
  async.eachLimit(txs, self.concurrency, function(tx, next) {

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

      var address = self._getAddressString(script);

      if(!address) {
        log.warn('Unsupported script type for output in ' + txid);
        continue;
      }

      var key = self.encoding.encodeAddressIndexKey(address, false, height, txid, outputIndex);
      var value = self.encoding.encodeAddressIndexValue(output.satoshis, output._scriptBuffer);
      operations.push({
        type: action,
        key: key,
        value: value
      });

      // Collect data for subscribers
      if (txmessages[address]) {
        txmessages[address].outputIndexes.push(outputIndex);
      } else {
        txmessages[address] = {
          tx: tx,
          height: height,
          outputIndexes: [outputIndex],
          address: address,
          timestamp: block.header.timestamp
        };
      }

      //this.balanceEventHandler(block, address);

    }

    // Publish events to any subscribers for this transaction
    for (var addressKey in txmessages) {
      //this.transactionEventHandler(txmessages[addressKey]);
    }

    if(tx.isCoinbase()) {
      return next();
    }

    async.eachOfLimit(inputs, self.concurrency, function(input, inputIndex, next) {
      var input = inputs[inputIndex];
      var inputHash;
      var inputHashType;

      if(!input.script) {
        log.debug('Invalid script');
        return next();
      }

      self.node.services.transaction.getTransaction(input.prevTxId.toString('hex'), function(err, tx) {
        if(err) {
          return next(err);
        }

        var output = tx.outputs[input.outputIndex];

        var address = self._getAddressString(input.script, output);

        if(!address) {
          log.warn('Unsupported script for input in transaction ' + txid);
          return next();
        }

        var inputKey = self.encoding.encodeAddressIndexKey(address, true, height, txid, inputIndex, true);

        var outputKey = self.encoding.encodeAddressIndexKey(address, true, tx.__height, tx.id, input.outputIndex, false);
        var outputKeyToDelete = self.encoding.encodeAddressIndexKey(address, false, tx.__height, tx.id, input.outputIndex, false);
        var outputValue = self.encoding.encodeAddressIndexValue(output.satoshis, output._scriptBuffer);
        var inputValue = self.encoding.encodeAddressIndexValue(output.satoshis, input._scriptBuffer);

        operations = operations.concat([{
          type: action,
          key: inputKey,
          value: inputValue
        },
        {
          type: action,
          key: outputKey,
          value: outputValue
        },
        {
          type: reverseAction,
          key: outputKeyToDelete,
          value: outputValue
        }]);
        next();
      });

    }, next);
  }, function(err) {
    callback(err, operations);
  });
};

AddressService.prototype._getAddressString = function(script, output) {
  var address = script.toAddress();
  if(address) {
    return address.toString();
  }

  try {
    var pubkey = script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {
    // if there is an error, it's because a pubkey can not be extracted from the script
    // continue on and return null
  }

  if(output && output.script && output.script.isPublicKeyOut()) {
    return output.script.getPublicKey().toString('hex');
  }

  return null;
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
    var spentIndexSyncKey = self.encoding.encodeSpentIndexSyncKey(txidBuffer, outputIndex);
    if (this.mempoolSpentIndex[spentIndexSyncKey]) {
      return this._getSpentMempool(txidBuffer, outputIndex, callback);
    }
  }
  var key = self.encoding.encodeInputKeyMap(txidBuffer, outputIndex);
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
    var value = self.encoding.decodeInputValueMap(buffer);
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

  return stream;

};

AddressService.prototype.createInputsDBStream = function(addressStr, options) {
  var stream;
  var addrObj = this.encoding.getAddressInfo(addressStr);
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

  var addrObj = self.encoding.getAddressInfo(addressStr);
  var hashBuffer = addrObj.hashBuffer;
  var hashTypeBuffer = addrObj.hashTypeBuffer;

  var stream = this.createInputsStream(addressStr, options);

  stream.on('data', function(input) {
    inputs.push(input);
    if (inputs.length > self.maxInputsQueryLength) {
      log.warn('Tried to query too many inputs (' + self.maxInputsQueryLength + ') for address '+ addressStr);
      error = new Error('Maximum number of inputs (' + self.maxInputsQueryLength + ') per query reached');
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

  return stream;

};

AddressService.prototype.createOutputsDBStream = function(addressStr, options) {

  var addrObj = this.encoding.getAddressInfo(addressStr);
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

  var addrObj = self.encoding.getAddressInfo(addressStr);
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
    var value = self.encoding.decodeOutputMempoolValue(data.value);
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

  var addressLengthBuffer = new Buffer(1);
  addressLengthBuffer.writeUInt8(address.length);
  var start = Buffer.concat([ self.prefix, addressLengthBuffer, new Buffer(address, 'utf8'), new Buffer('00', 'hex') ]);
  var end = Buffer.concat([ self.prefix, addressLengthBuffer, new Buffer(address, 'utf8'), new Buffer('01', 'hex') ]);
  var stream = self.store.createReadStream({
    gte: start,
    lt: end
  });

  var utxos = [];
  stream.on('data', function(data) {
    var key = self.encoding.decodeAddressIndexKey(data.key);
    var value = self.encoding.decodeAddressIndexValue(data.value);
    utxos.push({
      address: key.address,
      txid: key.txid,
      outputIndex: key.index,
      satoshis: value.satoshis,
      height: key.height
    });
  });

  stream.on('end', function() {
    return callback(null, utxos);
  });
  stream.on('error', function(err) {
    if(err) {
      return callback(err);
    }
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
    var spentIndexSyncKey = self.encoding.encodeSpentIndexSyncKey(txidBuffer, output.outputIndex);
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
  var self = this;

  var txids = [];

  async.eachLimit(addresses, self.concurrency, function(address, next) {
    self.getAddressTxids(address, options, function(err, tmpTxids) {
      if(err) {
        return next(err);
      }

      txids = _.union(txids, tmpTxids);
      return next();
    });
  }, function(err) {
    async.mapLimit(txids, self.concurrency, function(txid, next) {
      self.node.services.transaction.getTransaction(txid, function(err, tx) {
        if(err) {
          return next(err);
        }

        var txObj = tx.toObject();
        for(var i = 0; i < txObj.inputs.length; i++) {
          txObj.inputs[i].satoshis = tx.__inputValues[i];
        }

        next(null, txObj);
      });
    }, callback);
  });
};

AddressService.prototype.getAddressTxids = function(address, options, callback) {
  var self = this;

  self._getAddressTxidsByIndex(address, false, options.start, options.end, function(err, txids1) {
    if(err) {
      return callback(err);
    }

    self._getAddressTxidsByIndex(address, true, options.start, options.end, function(err, txids2) {
      if(err) {
        return callback(err);
      }

      callback(null, _.union(txids1, txids2));
    });
  });
};

AddressService.prototype._getAddressTxidsByIndex = function(address, isSpent, startHeight, endHeight, callback) {
  var self = this;

  var txids = {};

  var start = self.encoding.encodeAddressIndexKey(address, isSpent, startHeight);
  var end = self.encoding.encodeAddressIndexKey(address, isSpent, endHeight);

  var stream = self.store.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(buffer) {
    var key = self.encoding.decodeAddressIndexKey(buffer);
    txids[key.txid] = true;
  });

  stream.on('end', function() {
    callback(streamErr, Object.keys(txids));
  });

  stream.on('error', function(err) {
    streamErr = err;
  });
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
    },
    function(result, next) {
      self._setAndSortTxidsFromAppearanceIds(result, next);
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
    result.totalReceived += output.satoshis;
    result.appearanceIds[txid] = output.height;

    if(!options.noBalance) {

      // Bitcoind's isSpent only works for confirmed transactions
      var spentDB = self.node.services.bitcoind.isSpent(txid, outputIndex);

      if(!spentDB) {
        result.balance += output.satoshis;
      }

      if(options.queryMempool) {
        // Check to see if this output is spent in the mempool and if so
        // we will subtract it from the unconfirmedBalance (a.k.a unconfirmedDelta)
        var spentIndexSyncKey = self.encoding.encodeSpentIndexSyncKey(
          new Buffer(txid, 'hex'), // TODO: get buffer directly
          outputIndex
        );
        var spentMempool = self.mempoolSpentIndex[spentIndexSyncKey];
        if(spentMempool) {
          result.unconfirmedBalance -= output.satoshis;
        }
      }
    }

    count++;

    if (count > self.maxOutputsQueryLength) {
      log.warn('Tried to query too many outputs (' + self.maxOutputsQueryLength + ') for summary of address ' + address.toString());
      error = new Error('Maximum number of outputs (' + self.maxOutputsQueryLength + ') per query reached');
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
  result.unconfirmedTxids = Object.keys(result.unconfirmedAppearanceIds);
  result.unconfirmedTxids.sort(function(a, b) {
    return result.unconfirmedAppearanceIds[a] - result.unconfirmedAppearanceIds[b];
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
  var addressIndexKey = self.encoding.encodeMempoolAddressIndexKey(hashBuffer, hashTypeBuffer);

  if(!this.mempoolAddressIndex[addressIndexKey]) {
    return callback(null, result);
  }

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

          if(!options.noBalance) {
            var spentIndexSyncKey = self.encoding.encodeSpentIndexSyncKey(
              new Buffer(output.txid, 'hex'), // TODO: get buffer directly
              output.outputIndex
            );
            var spentMempool = self.mempoolSpentIndex[spentIndexSyncKey];
            // Only add this to the balance if it's not spent in the mempool already
            if(!spentMempool) {
              result.unconfirmedBalance += output.satoshis;
            }
          }
        }
        next(null, result);
      });
    }
  ], callback);
};

AddressService.prototype._transformAddressSummaryFromResult = function(result, options) {

  var confirmedTxids = result.txids;
  var unconfirmedTxids = result.unconfirmedTxids;

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
