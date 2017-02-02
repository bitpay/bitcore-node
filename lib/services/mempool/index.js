'use strict';
var BaseService = require('../../service');
var util = require('util');
var bitcore = require('bitcore-lib');
var Encoding = require('./encoding');
var index = require('../../index');
var log = index.log;
var async = require('async');

var MempoolService = function(options) {
  BaseService.call(this, options);
  this.node = options.node;
  this.name = options.name;
  this._txIndex = {};
  this._addressIndex = {};
  this.store = this.node.services.db.store;
  this._handleBlocks = false;
};

util.inherits(MempoolService, BaseService);

MempoolService.dependencies = [ 'bitcoind', 'db' ];

MempoolService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  if (!self._handleBlocks) {
    return setImmediate(callback);
  }

  var txs = block.transactions;

  var action = 'del';
  if (!connectBlock) {
    action = 'put';
  }

  for(var i = 0; i < txs.length; i++) {

    var tx = txs[i];
    self._updateMempool(tx, action);
  }
  setImmediate(callback);
};

MempoolService.prototype.getPublishEvents = function() {
  return [];
};

MempoolService.prototype.getAPIMethods = function() {
  return [];
};

MempoolService.prototype.start = function(callback) {
  var self = this;
  self.node.services.db.on('synced', function() {
    var bus = self.node.openBus({ remoteAddress: 'localhost' });
    bus.subscribe('bitcoind/rawtransaction');

    bus.on('bitcoind/rawtransaction', function(txHex) {
      var tx = new bitcore.Transaction(txHex);
      self._updateMempool(tx, 'put');
    });
    self._handleBlocks = true;
  });
  self.node.services.db.getPrefix(self.name, function(err, servicePrefix) {
    if(err) {
      return callback(err);
    }
    self.servicePrefix = servicePrefix;
    self._encoding = new Encoding(self.servicePrefix);
    callback();
  });
};

/**
 * Function to be called when bitcore-node is stopped
 */
MempoolService.prototype.stop = function(done) {
  setImmediate(done);
};

/**
 * Setup express routes
 * @param  {Express} app
 */
MempoolService.prototype.setupRoutes = function() {
  // Setup express routes here
};

MempoolService.prototype.getRoutePrefix = function() {
  return this.name;
};

MempoolService.prototype._getTransactionAddressDetailOperations = function(tx, action) {
  var self = this;

  if(tx.isCoinbase()) {
      return [];
  }
  var operations = [];

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

    var key = self.encoding.encodeMempoolAddressIndexKey(address, txid);
    operations.push({
      type: action,
      key: key
    });

  }

  //TODO deal with P2PK
  for(var i = 0; i < inputs.length; i++) {
    var input = inputs[i];
    if(!input.script) {
      log.debug('Invalid script');
      continue;
    }

    var inputAddress = self.getAddressString(input.script);

    if(!inputAddress) {
      continue;
    }

    var inputKey = self.encodeMempoolAddressIndexKey(inputAddress, txid);

    operations.push({
      type: action,
      key: inputKey
    });
  }
  return operations;
};

MempoolService.prototype.getAddressString = function(script, output) {
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
    //log.warn('Error getting public key from: ', script.toASM(), script.toHex());
    // if there is an error, it's because a pubkey can not be extracted from the script
    // continue on and return null
  }

  //TODO add back in P2PK, but for this we need to look up the utxo for this script
  if(output && output.script && output.script.isPublicKeyOut()) {
    return output.script.getPublicKey().toString('hex');
  }

  //log.warn('No utxo given for script spending a P2PK: ', script.toASM(), script.toHex());
  return null;
};

MempoolService.prototype._getInputValues = function(tx, callback) {
  var self = this;

  if (tx.isCoinbase()) {
    return callback(null, []);
  }

  async.mapLimit(tx.inputs, this.concurrency, function(input, next) {
    self.getTransaction(input.prevTxId.toString('hex'), {}, function(err, prevTx) {
      if(err) {
        return next(err);
      }
      if (!prevTx) {
        return next(null, 0);
      }
      if (!prevTx.outputs[input.outputIndex]) {
        return next(new Error('Input did not have utxo.'));
      }
      var satoshis = prevTx.outputs[input.outputIndex].satoshis;
      next(null, satoshis);
    });
  }, callback);
};


MempoolService.prototype._updateCache = function(operation) {
  if (operation.type === 'del') {
    return this._cache.del(operation.key);
  }
  this._cache.set(operation.key, operation.value);
};

MempoolService.prototype.getTransaction = function(txid, callback) {
  var self = this;
  var key = self._encoding.encodeMempoolTransactionKey(txid);
  var txBuffer = self._cache.get(key);
  if (txBuffer) {
    return setImmediate(function() {
      callback(null, self._encoding.decodeMempoolTransactionValue(txBuffer));
    });
  }
  self.store.get(key, function(err, value) {
    if(err) {
      return callback(err);
    }
    callback(null, self._encoding.decodeMempoolTransactionValue(value));
  });
};

MempoolService.prototype._getTransactionOperation = function(tx, action, callback) {
  var self = this;
  self._getInputValues(tx, function(err, inputValues) {
    if(err) {
      return callback(err);
    }
    tx.__inputValues = inputValues;
    var operation = {
      type: action,
      key: self._encoding.encodeMempoolTransactionKey(tx.id),
      value: self._encoding.encodeMempoolTransactionValue(tx)
    };
    callback(null, operation);
  });
};

MempoolService.prototype._updateMempool = function(tx, action, callback) {
  var self = this;
  self._getTransactionOperation(tx, action, function(err, operation) {
    if(err) {
      return callback(err);
    }
    var operations = [operation].concat(self._getTransactionAddressDetailOperations(tx, action));
    self.store.batch(operations, function(err) {
      if(err) {
        log.error('batch operation for updating Mempool failed.');
        return;
      }
      operations.forEach(self._updateCache);
    });
  });
};

MempoolService.prototype.getTransactionsByAddress = function(address, callback) {
  var self = this;
  var txids = [];
  var maxTxid = new Buffer(new Array(65).join('f'), 'hex');
  var start = self._encoding.encodeMempoolAddressKey(address);
  var end = Buffer.concat([self._encoding.encodeMempoolAddressKey(address), maxTxid]);
  var stream = self.store.createKeyStream({
    gte: start,
    lte: end
  });
  var streamErr;
  stream.on('error', function(err) {
    streamErr = err;
  });
  stream.on('data', function(data) {
    var key = self._encoding.decodeMempoolAddressKey(data);
    txids.push(key.txid);
  });
  stream.on('end', function() {
    async.mapLimit(txids, 10, function(txid, next) {
      self.getTransaction(txid, next);
    }, callback);
  });
};

MempoolService.prototype.getTransactionsByAddresses = function(addresses, callback) {
  var self = this;
  var transactions = {};
  async.eachLimit(addresses, 10, function(address, next) {
    self.getTransactionsByAddress(address, function(err, txs) {
      if(err) {
        return next(err);
      }
      txs.forEach(function(tx) {
        transactions[tx.id] = tx;
      });
      next();
    });
  }, function(err) {
    if(err) {
      return callback(err);
    }
    callback(null, Object.values(transactions));
  });
};

module.exports = MempoolService;

