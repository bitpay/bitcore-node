'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
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

};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db'
];

AddressService.PREFIXES = {
  OUTPUTS: 'outs',
  SPENTS: 'sp'
};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2]
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

  // Find the address for the output
  var address = script.toAddress(this.node.network);
  if (!address && script.isPublicKeyOut()) {
    var pubkey = script.chunks[0].buf;
    address = Address.fromPublicKey(new PublicKey(pubkey), this.node.network);
  } else if (!address){
    return;
  }

  // Collect data to publish to address subscribers
  if (messages[address]) {
    messages[address].outputIndexes.push(outputIndex);
  } else {
    messages[address] = {
      tx: tx,
      outputIndexes: [outputIndex],
      address: address.toString(),
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

  for (var key in messages) {
    this.transactionEventHandler(messages[key]);
  }
};

AddressService.prototype.blockHandler = function(block, addOutput, callback) {
  var txs = block.transactions;

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

      var address = script.toAddress(this.node.network);
      if (!address && script.isPublicKeyOut()) {
        var pubkey = script.chunks[0].buf;
        address = Address.fromPublicKey(new PublicKey(pubkey), this.node.network);
      } else if (!address){
        continue;
      }

      // We need to use the height for indexes (and not the timestamp) because the
      // the timestamp has unreliable sequential ordering. The next block
      // can have a time that is previous to the previous block (however not
      // less than the mean of the 11 previous blocks) and not greater than 2
      // hours in the future.
      var height = block.__height;

      var addressStr = address.toString();
      var scriptHex = output._scriptBuffer.toString('hex');

      // To lookup outputs by address and height
      var key = [
        AddressService.PREFIXES.OUTPUTS,
        addressStr,
        height,
        txid,
        outputIndex
      ].join('-');

      var value = [output.satoshis, scriptHex].join(':');

      operations.push({
        type: action,
        key: key,
        value: value
      });

      // Collect data for subscribers
      if (txmessages[addressStr]) {
        txmessages[addressStr].outputIndexes.push(outputIndex);
      } else {
        txmessages[addressStr] = {
          tx: tx,
          height: block.__height,
          outputIndexes: [outputIndex],
          address: addressStr,
          timestamp: block.header.timestamp
        };
      }

      this.balanceEventHandler(block, address);

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
      var inputAddress = input.script.toAddress(this.node.network);

      if (inputAddress) {

        var inputObject = input.toObject();
        var inputAddressStr = inputAddress.toString();

        var height = block.__height;

        // To be able to query inputs by address and spent height
        var inputKey = [
          AddressService.PREFIXES.SPENTS,
          inputAddressStr,
          height,
          inputObject.prevTxId,
          inputObject.outputIndex
        ].join('-');

        var inputValue = [
          txid,
          inputIndex
        ].join(':');

        operations.push({
          type: action,
          key: inputKey,
          value: inputValue
        });
      }
    }
  }

  setImmediate(function() {
    callback(null, operations);
  });
};

/**
 * @param {Object} obj
 * @param {Transaction} obj.tx - The transaction
 * @param {String} [obj.address] - The address for the subscription
 * @param {Array} [obj.outputIndexes] - Indexes of the inputs that includes the address
 * @param {Array} [obj.inputIndexes] - Indexes of the outputs that includes the address
 * @param {Date} [obj.timestamp] - The time of the block the transaction was included
 * @param {Number} [obj.height] - The height of the block the transaction was included
 * @param {Boolean} [obj.rejected] - If the transaction was not accepted in the mempool
 */
AddressService.prototype.transactionEventHandler = function(obj) {
  if(this.subscriptions['address/transaction'][obj.address]) {
    var emitters = this.subscriptions['address/transaction'][obj.address];
    for(var i = 0; i < emitters.length; i++) {
      emitters[i].emit('address/transaction', obj);
    }
  }
};

AddressService.prototype.balanceEventHandler = function(block, address) {
  if(this.subscriptions['address/balance'][address]) {
    var emitters = this.subscriptions['address/balance'][address];
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
    if(!this.subscriptions[name][addresses[i]]) {
      this.subscriptions[name][addresses[i]] = [];
    }
    this.subscriptions[name][addresses[i]].push(emitter);
  }
};

AddressService.prototype.unsubscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses) || _.isUndefined(addresses), 'Second argument is expected to be an Array of addresses or undefined');

  if(!addresses) {
    return this.unsubscribeAll(name, emitter);
  }

  for(var i = 0; i < addresses.length; i++) {
    if(this.subscriptions[name][addresses[i]]) {
      var emitters = this.subscriptions[name][addresses[i]];
      var index = emitters.indexOf(emitter);
      if(index > -1) {
        emitters.splice(index, 1);
      }
    }
  }
};

AddressService.prototype.unsubscribeAll = function(name, emitter) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');

  for(var address in this.subscriptions[name]) {
    var emitters = this.subscriptions[name][address];
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

  if (options.start && options.end) {

    // The positions will be flipped because the end position should be greater
    // than the starting position for the stream, and we'll add one to the end key
    // so that it's included in the results.

    var endKey = [AddressService.PREFIXES.SPENTS, addressStr, options.start + 1].join('-');
    var startKey = [AddressService.PREFIXES.SPENTS, addressStr, options.end].join('-');

    stream = this.node.services.db.store.createReadStream({
      start: startKey,
      end: endKey
    });
  } else {
    var allKey = [AddressService.PREFIXES.SPENTS, addressStr].join('-');
    stream = this.node.services.db.store.createReadStream({
      start: allKey,
      end: allKey + '~'
    });
  }

  stream.on('data', function(data) {

    var key = data.key.split('-');
    var value = data.value.split(':');

    var blockHeight = Number(key[2]);

    var output = {
      address: addressStr,
      txid: value[0],
      inputIndex: Number(value[1]),
      height: blockHeight,
      confirmations: self.node.services.db.tip.__height - blockHeight + 1
    };

    inputs.push(output);

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

    // TODO include results from mempool

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

  var outputs = [];
  var stream;

  if (options.start && options.end) {

    // The positions will be flipped because the end position should be greater
    // than the starting position for the stream, and we'll add one to the end key
    // so that it's included in the results.
    var endKey = [AddressService.PREFIXES.OUTPUTS, addressStr, options.start + 1].join('-');
    var startKey = [AddressService.PREFIXES.OUTPUTS, addressStr, options.end].join('-');

    stream = this.node.services.db.store.createReadStream({
      start: startKey,
      end: endKey
    });
  } else {
    var allKey = [AddressService.PREFIXES.OUTPUTS, addressStr].join('-');
    stream = this.node.services.db.store.createReadStream({
      start: allKey,
      end: allKey + '~'
    });
  }

  stream.on('data', function(data) {

    var key = data.key.split('-');
    var value = data.value.split(':');

    var output = {
      address: addressStr,
      txid: key[3],
      outputIndex: Number(key[4]),
      height: Number(key[2]),
      satoshis: Number(value[0]),
      script: value[1],
      confirmations: self.node.services.db.tip.__height - Number(key[2]) + 1
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
      outputs = outputs.concat(self.node.services.bitcoind.getMempoolOutputs(addressStr));
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
 * This will give the history for many addresses limited by a range of dates (to limit
 * the database lookup times) and/or paginated to limit the results length.
 * @param {Array} addresses - An array of addresses
 * @param {Object} options - The options to limit the query
 * @param {Number} [options.from] - The pagination "from" index
 * @param {Number} [options.to] - The pagination "to" index
 * @param {Number} [options.start] - The beginning block height
 * @param {Number} [options.end] - The ending block height
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

module.exports = AddressService;
