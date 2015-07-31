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
var EventEmitter = require('events').EventEmitter;
var PublicKey = bitcore.PublicKey;
var Address = bitcore.Address;

var AddressModule = function(options) {
  BaseModule.call(this, options);

  this.subscriptions = {};
  this.subscriptions.transaction = {};
  this.subscriptions.balance = {};
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
      name: 'transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'balance',
      scope: this,
      subscribe: this.subscribe.bind(this, 'balance'),
      unsubscribe: this.unsubscribe.bind(this, 'balance')
    }
  ];
};

AddressModule.prototype.blockHandler = function(block, addOutput, callback) {
  var txs = this.db.getTransactionsFromBlock(block);

  log.debug('Updating output index');

  var action = 'put';
  if (!addOutput) {
    action = 'del';
  }

  var operations = [];

  for (var i = 0; i < txs.length; i++) {

    var tx = txs[i];
    var txid = tx.id;
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    for (var j = 0; j < outputs.length; j++) {
      var output = outputs[j];

      var script = output.script;
      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      if (!script.isPublicKeyHashOut() && !script.isScriptHashOut() && !script.isPublicKeyOut()) {
        // ignore for now
        log.debug('script was not pubkeyhashout, scripthashout, or pubkeyout');
        continue;
      }

      var address;

      if(script.isPublicKeyOut()) {
        var pubkey = script.chunks[0].buf;
        address = Address.fromPublicKey(new PublicKey(pubkey), this.db.network);
      } else {
        address = output.script.toAddress(this.db.network);
      }

      var outputIndex = j;

      var timestamp = block.timestamp.getTime();
      var height = block.__height;

      operations.push({
        type: action,
        key: [AddressModule.PREFIXES.OUTPUTS, address, timestamp, txid, outputIndex].join('-'),
        value: [output.satoshis, script, height].join(':')
      });

      // publish events to any subscribers
      this.transactionEventHandler(block, address, tx);
      this.balanceEventHandler(block, address);

    }

    if(tx.isCoinbase()) {
      continue;
    }

    for(var j = 0; j < inputs.length; j++) {
      var input = inputs[j].toObject();
      operations.push({
        type: action,
        key: [AddressModule.PREFIXES.SPENTS, input.prevTxId, input.outputIndex].join('-'),
        value: [txid, j].join(':')
      });
    }
  }

  setImmediate(function() {
    callback(null, operations);
  });
};

AddressModule.prototype.transactionEventHandler = function(block, address, tx) {
  if(this.subscriptions.transaction[address]) {
    var emitters = this.subscriptions.transaction[address];
    for(var k = 0; k < emitters.length; k++) {
      emitters[k].emit('transaction', address, tx, block);
    }
  }
};

AddressModule.prototype.balanceEventHandler = function(block, address) {
  if(this.subscriptions.balance[address]) {
    var emitters = this.subscriptions.balance[address];
    this.getBalance(address, true, function(err, balance) {
      if(err) {
        return this.emit(err);
      }

      for(var i = 0; i < emitters.length; i++) {
        emitters[i].emit('balance', address, balance, block);
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
  $.checkArgument(Array.isArray(addresses), 'Second argument is expected to be an Array of addresses');

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

AddressModule.prototype.getOutputs = function(address, queryMempool, callback) {
  var self = this;

  var outputs = [];
  var key = [AddressModule.PREFIXES.OUTPUTS, address].join('-');

  var stream = this.db.store.createReadStream({
    start: key,
    end: key + '~'
  });

  stream.on('data', function(data) {

    var key = data.key.split('-');
    var value = data.value.split(':');

    var output = {
      address: key[1],
      txid: key[3],
      outputIndex: Number(key[4]),
      satoshis: Number(value[0]),
      script: value[1],
      blockHeight: Number(value[2])
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
      outputs = outputs.concat(self.db.bitcoind.getMempoolOutputs(address));
    }

    callback(null, outputs);
  });

  return stream;

};

AddressModule.prototype.getUnspentOutputs = function(address, queryMempool, callback) {

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

AddressModule.prototype.getAddressHistory = function(address, queryMempool, callback) {
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
          satoshis: 0,
          height: transaction.__height,
          timestamp: transaction.__timestamp,
          outputIndexes: [],
          inputIndexes: [],
          transaction: transaction
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
              txinfo.satoshis -= txinfo.transaction.inputs[spendInfo.inputIndex].output.satoshis;
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