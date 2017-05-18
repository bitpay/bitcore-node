'use strict';

var assert = require('assert');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var Address = bitcore.Address;
var Encoding = require('./encoding');
var utils = require('../../utils');

var AddressService = function(options) {
  BaseService.call(this, options);
  this.concurrency = options.concurrency || 20;
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db',
  'transaction'
];

AddressService.prototype.start = function(callback) {
  var self = this;

  this.db = this.node.services.db;
  this.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;

    self._encoding = new Encoding(self.prefix);

    callback();
  });
};

AddressService.prototype.stop = function(callback) {
  setImmediate(callback);
};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUtxos', this, this.getUtxos, 2],
    ['getInputForOutput', this, this.getInputForOutput, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
};

AddressService.prototype.getPublishEvents = function() {
  return [];
};

AddressService.prototype.concurrentBlockHandler = function(block, connectBlock, callback) {
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

  for(var i = 0; i < txs.length; i++) {

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

      var address = self.getAddressString(script);
      if(!address) {
        continue;
      }

      var key = self._encoding.encodeAddressIndexKey(address, height, txid);
      operations.push({
        type: action,
        key: key
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
    }

    if(tx.isCoinbase()) {
      continue;
    }

    //TODO deal with P2PK
    for(var inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
      var input = inputs[inputIndex];

      if(!input.script) {
        log.debug('Invalid script');
        continue;
      }

      var inputAddress = self.getAddressString(input.script);

      if(!inputAddress) {
        continue;
      }

      var inputKey = self._encoding.encodeAddressIndexKey(inputAddress, height, txid);

      operations.push({
        type: action,
        key: inputKey
      });

    }
  }
  setImmediate(function() {
    callback(null, operations);
  });
};

AddressService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  var txs = block.transactions;

  var action = 'put';
  var reverseAction = 'del';
  if (!connectBlock) {
    action = 'del';
    reverseAction = 'put';
  }

  var operations = [];

  async.eachSeries(txs, function(tx, next) {
    var txid = tx.id;
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    var outputLength = outputs.length;
    for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      var output = outputs[outputIndex];

      var script = output.script;

      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      var address = self.getAddressString(script);

      if(!address) {
        continue;
      }

      var key = self._encoding.encodeUtxoIndexKey(address, txid, outputIndex);
      var value = self._encoding.encodeUtxoIndexValue(block.__height, output.satoshis, output._scriptBuffer);
      operations.push({
        type: action,
        key: key,
        value: value
      });

    }

    if(tx.isCoinbase()) {
      return next();
    }

    //TODO deal with P2PK
    async.each(inputs, function(input, next) {
      if(!input.script) {
        log.debug('Invalid script');
        return next();
      }

      var inputAddress = self.getAddressString(input.script);

      if(!inputAddress) {
        return next();
      }

      var inputKey = self._encoding.encodeUtxoIndexKey(inputAddress, input.prevTxId, input.outputIndex);
      //common case is connecting blocks and deleting outputs spent by these inputs
      if (connectBlock) {
        operations.push({
          type: 'del',
          key: inputKey
        });
        next();
      } else { // uncommon and slower, this happens during a reorg
        self.node.services.transaction.getTransaction(input.prevTxId.toString('hex'), {}, function(err, tx) {
          var utxo = tx.outputs[input.outputIndex];
          var inputValue = self._encoding.encodeUtxoIndexValue(tx.__height, utxo.satoshis, utxo._scriptBuffer);
          operations.push({
            type: 'put',
            key: inputKey,
            value: inputValue
          });
          next();
        });
      }
    }, function(err) {
      if(err) {
        return next(err);
      }
      next();
    });
  }, function(err) {
    //we are aync predicated on reorg sitch
    if(err) {
      return callback(err);
    }
    callback(null, operations);
  });
};

AddressService.prototype.getAddressString = function(script, output) {
  var address = script.toAddress(this.node.network.name);
  if(address) {
    return address.toString();
  }

  try {
    var pubkey = script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {
  }

  //TODO add back in P2PK, but for this we need to look up the utxo for this script
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
  this.getUtxos(address, queryMempool, function(err, outputs) {
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


AddressService.prototype.getUtxos = function(addresses, queryMempool, callback) {
  var self = this;

  if(!Array.isArray(addresses)) {
    addresses = [addresses];
  }

  var utxos = [];

  async.eachSeries(addresses, function(address, next) {
    self.getUtxosForAddress(address, queryMempool, function(err, unspents) {
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

AddressService.prototype.getUtxosForAddress = function(address, queryMempool, callback) {

  var self = this;

  var stream = self.db.createReadStream({
    gte: self._encoding.encodeUtxoIndexKey(address),
    lt: self._encoding.encodeUtxoIndexKey(utils.getTerminalKey(new Buffer(address)))
  });

  var utxos = [];
  stream.on('data', function(data) {
    var key = self._encoding.decodeUtxoIndexKey(data.key);
    var value = self._encoding.decodeUtxoIndexValue(data.value);
    utxos.push({
      address: key.address,
      txid: key.txid,
      outputIndex: key.outputIndex,
      satoshis: value.satoshis,
      height: value.height,
      script: value.script
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

AddressService.prototype.isUnspent = function(output, options, callback) {
  $.checkArgument(_.isFunction(callback));
  this.isSpent(output, options, function(spent) {
    callback(!spent);
  });
};

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
  }, function() {
    async.mapLimit(txids, self.concurrency, function(txid, next) {
      self.node.services.transaction.getTransaction(txid.toString('hex'), options, function(err, tx) {
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

  var opts = options || { start: 0, end: 0xffffffff, txid: new Array(65).join('0') };
  var txids = {};

  var start = self._encoding.encodeAddressIndexKey(address, opts.start, opts.txid);
  var end = self._encoding.encodeAddressIndexKey(address, opts.end, opts.txid);

  var stream = self.db.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;
  stream.on('close', function() {
  });

  stream.on('data', function(buffer) {
    var key = self._encoding.decodeAddressIndexKey(buffer);
    txids[key.txid] = true;
  });

  stream.on('end', function() {
    callback(streamErr, Object.keys(txids));
  });

  stream.on('error', function(err) {
    streamErr = err;
  });
};

AddressService.prototype.getAddressTxidsWithHeights = function(address, options, callback) {
  var self = this;

  var opts = options || {};
  var txids = {};

  var start = self._encoding.encodeAddressIndexKey(address, opts.start || 0); //the start and end must be the same length
  var end = Buffer.concat([ start.slice(0, -36), new Buffer((opts.end || 'ffffffff'), 'hex') ]);

  var stream = self.db.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(buffer) {
    var key = self._encoding.decodeAddressIndexKey(buffer);
    assert(key.txid.length === 64, 'AddressService, Txid: ' + key.txid + ' with length: ' + key.txid.length + ' does not resemble a txid.');
    txids[key.txid] = key.height;
  });

  stream.on('end', function() {
    callback(streamErr, txids);
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


module.exports = AddressService;
