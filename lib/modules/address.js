'use strict';

var BaseModule = require('../module');
var inherits = require('util').inherits;
var async = require('async');
var chainlib = require('chainlib');
var log = chainlib.log;
var levelup = chainlib.deps.levelup;
var errors = chainlib.errors;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var PublicKey = bitcore.PublicKey;
var Address = bitcore.Address;

var AddressModule = function(options) {
  BaseModule.call(this, options);

  this.subscriptions = {};
  this.subscriptions['address/transaction'] = {};
  this.subscriptions['address/balance'] = {};

  this.db.bitcoind.on('tx', this.transactionHandler.bind(this));

};

inherits(AddressModule, BaseModule);

AddressModule.PREFIXES = {
  OUTPUTS: 'outs',
  SPENTS: 'sp'
};

AddressModule.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2]
  ];
};

AddressModule.prototype.getPublishEvents = function() {
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
    },
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
AddressModule.prototype.transactionOutputHandler = function(messages, tx, outputIndex, rejected) {
  var script = tx.outputs[outputIndex].script;

  // If the script is invalid skip
  if (!script) {
    return;
  }

  // Find the address for the output
  var address = script.toAddress(this.db.network);
  if (!address && script.isPublicKeyOut()) {
    var pubkey = script.chunks[0].buf;
    address = Address.fromPublicKey(new PublicKey(pubkey), this.db.network);
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
AddressModule.prototype.transactionHandler = function(txInfo) {

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

AddressModule.prototype.blockHandler = function(block, addOutput, callback) {
  var txs = this.db.getTransactionsFromBlock(block);

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
    for (var j = 0; j < outputLength; j++) {
      var output = outputs[j];

      var script = output.script;

      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      var address = script.toAddress(this.db.network);
      if (!address && script.isPublicKeyOut()) {
        var pubkey = script.chunks[0].buf;
        address = Address.fromPublicKey(new PublicKey(pubkey), this.db.network);
      } else if (!address){
        continue;
      }

      var outputIndex = j;
      var timestamp = block.timestamp.getTime();
      var height = block.__height;

      var addressStr = address.toString();
      var scriptHex = output._scriptBuffer.toString('hex');

      var key = [AddressModule.PREFIXES.OUTPUTS, addressStr, timestamp, txid, outputIndex].join('-');
      var value = [output.satoshis, scriptHex, height].join(':');

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
          timestamp: block.timestamp
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

    for(var k = 0; k < inputs.length; k++) {
      var input = inputs[k].toObject();
      operations.push({
        type: action,
        key: [AddressModule.PREFIXES.SPENTS, input.prevTxId, input.outputIndex].join('-'),
        value: [txid, k].join(':')
      });
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
AddressModule.prototype.transactionEventHandler = function(obj) {
  if(this.subscriptions['address/transaction'][obj.address]) {
    var emitters = this.subscriptions['address/transaction'][obj.address];
    for(var i = 0; i < emitters.length; i++) {
      emitters[i].emit('address/transaction', obj);
    }
  }
};

AddressModule.prototype.balanceEventHandler = function(block, address) {
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

AddressModule.prototype.subscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses), 'Second argument is expected to be an Array of addresses');

  for(var i = 0; i < addresses.length; i++) {
    if(!this.subscriptions[name][addresses[i]]) {
      this.subscriptions[name][addresses[i]] = [];
    }
    this.subscriptions[name][addresses[i]].push(emitter);
  }
};

AddressModule.prototype.unsubscribe = function(name, emitter, addresses) {
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

AddressModule.prototype.unsubscribeAll = function(name, emitter) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');

  for(var address in this.subscriptions[name]) {
    var emitters = this.subscriptions[name][address];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
    }
  }
};

AddressModule.prototype.getBalance = function(address, queryMempool, callback) {
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

AddressModule.prototype.getOutputs = function(addressStr, queryMempool, callback) {
  var self = this;

  var outputs = [];
  var key = [AddressModule.PREFIXES.OUTPUTS, addressStr].join('-');

  var stream = this.db.store.createReadStream({
    start: key,
    end: key + '~'
  });

  stream.on('data', function(data) {

    var key = data.key.split('-');
    var value = data.value.split(':');

    var output = {
      address: addressStr,
      txid: key[3],
      outputIndex: Number(key[4]),
      timestamp: key[2],
      satoshis: Number(value[0]),
      script: value[1],
      blockHeight: Number(value[2]),
      confirmations: self.db.chain.tip.__height - Number(value[2]) + 1
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

    if(queryMempool) {
      outputs = outputs.concat(self.db.bitcoind.getMempoolOutputs(addressStr));
    }

    callback(null, outputs);
  });

  return stream;

};

AddressModule.prototype.getUnspentOutputs = function(addresses, queryMempool, callback) {
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

AddressModule.prototype.getUnspentOutputsForAddress = function(address, queryMempool, callback) {

  var self = this;

  this.getOutputs(address, queryMempool, function(err, outputs) {
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

AddressModule.prototype.isUnspent = function(output, queryMempool, callback) {
  this.isSpent(output, queryMempool, function(spent) {
    callback(!spent);
  });
};

AddressModule.prototype.isSpent = function(output, queryMempool, callback) {
  var self = this;
  var txid = output.prevTxId ? output.prevTxId.toString('hex') : output.txid;

  setImmediate(function() {
    callback(self.db.bitcoind.isSpent(txid, output.outputIndex));
  });
};

AddressModule.prototype.getSpendInfoForOutput = function(txid, outputIndex, callback) {
  var self = this;

  var key = [AddressModule.PREFIXES.SPENTS, txid, outputIndex].join('-');
  this.db.store.get(key, function(err, value) {
    if(err) {
      return callback(err);
    }

    value = value.split(':');

    var info = {
      txid: value[0],
      inputIndex: value[1]
    };

    callback(null, info);
  });
};

AddressModule.prototype.getAddressHistory = function(addresses, queryMempool, callback) {
  var self = this;

  if(!Array.isArray(addresses)) {
    addresses = [addresses];
  }

  var history = [];

  async.eachSeries(addresses, function(address, next) {
    self.getAddressHistoryForAddress(address, queryMempool, function(err, h) {
      if(err) {
        return next(err);
      }

      history = history.concat(h);
      next();
    });
  }, function(err) {
    callback(err, history);
  });
};

AddressModule.prototype.getAddressHistoryForAddress = function(address, queryMempool, callback) {
  var self = this;

  var txinfos = {};

  function getTransactionInfo(txid, callback) {
    if(txinfos[txid]) {
      return callback(null, txinfos[txid]);
    }

    self.db.getTransactionWithBlockInfo(txid, queryMempool, function(err, transaction) {
      if(err) {
        return callback(err);
      }

      transaction.populateInputs(self.db, [], function(err) {
        if(err) {
          return callback(err);
        }

        txinfos[transaction.hash] = {
          address: address,
          satoshis: 0,
          height: transaction.__height,
          confirmations: self.db.chain.tip.__height - transaction.__height + 1,
          timestamp: transaction.__timestamp,
          outputIndexes: [],
          inputIndexes: [],
          tx: transaction
        };

        callback(null, txinfos[transaction.hash]);
      });
    });
  }

  this.getOutputs(address, queryMempool, function(err, outputs) {
    if(err) {
      return callback(err);
    }

    async.eachSeries(
      outputs,
      function(output, next) {
        getTransactionInfo(output.txid, function(err, txinfo) {
          if(err) {
            return next(err);
          }

          txinfo.outputIndexes.push(output.outputIndex);
          txinfo.satoshis += output.satoshis;

          self.getSpendInfoForOutput(output.txid, output.outputIndex, function(err, spendInfo) {
            if(err instanceof levelup.errors.NotFoundError) {
              return next();
            } else if(err) {
              return next(err);
            }

            getTransactionInfo(spendInfo.txid, function(err, txinfo) {
              if(err) {
                return next(err);
              }

              txinfo.inputIndexes.push(spendInfo.inputIndex);
              txinfo.satoshis -= txinfo.tx.inputs[spendInfo.inputIndex].output.satoshis;
              next();
            });
          });
        });
      },
      function(err) {
        if(err) {
          return callback(err);
        }

        // convert to array
        var history = [];
        for(var txid in txinfos) {
          history.push(txinfos[txid]);
        }

        // sort by height
        history.sort(function(a, b) {
          return a.height > b.height;
        });

        callback(null, history);
      }
    );
  });
};

module.exports = AddressModule;
