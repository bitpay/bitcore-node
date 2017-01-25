'use strict';

var async = require('async');
var BaseService = require('../service');
var inherits = require('util').inherits;
var bitcore = require('bitcore-lib');
var _ = require('lodash');
var LRU = require('lru-cache');
var utils = require('./wallet-api/utils');
/**
 * The Transaction Service builds upon the Database Service and the Bitcoin Service to add additional
 * functionality for getting information by bitcoin transaction hash/id. This includes the current
 * bitcoin memory pool as validated by a trusted bitcoind instance.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 */
function TransactionService(options) {
  BaseService.call(this, options);
  this.concurrency = options.concurrency || 20;

  /* upon initialization of the mempool, only txids are obtained from
  *  a trusted bitcoin node (the bitcoind service's rpchost or p2p option)
  *  Since, the mempool is very temporal, I see no reason to take the
  *  resources to gather the actual tx data. Any NEW txs that arrive
  *  after the mempool is initialized will have their full tx data
  *  If a tx is queried from the mempool and it does not have tx data,
  *  then call to the trusted bitcoind will take place and the result set.
  */
  this._mempool = LRU({
    max: 100 * 1024 * 1024, //100MB
    length: function(tx) { if (tx) { return tx.toBuffer().length; } }
  });
  this.currentTransactions = {};
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'db',
  'timestamp'
];

TransactionService.prototype.start = function(callback) {
  var self = this;

  self.store = this.node.services.db.store;

  var bus = self.node.openBus({ remoteAddress: 'localhost' });
  bus.subscribe('bitcoind/rawtransaction');

  bus.on('bitcoind/rawtransaction', function(txHex) {
    var tx = new bitcore.Transaction(txHex);
    self._updateMempool(tx);
  });

  async.series([
    function(next) {
      self.node.services.bitcoind.getMempool(function(err, txidList) {
        if(err) {
          return next(err);
        }
        for(var i = 0; i < txidList.length; i++) {
          self._updateMempool(txidList[i]);
        }
        next();
      });
    }, function(next) {
      self.node.services.db.getPrefix(self.name, function(err, prefix) {
        if(err) {
          return callback(err);
        }
        self.prefix = prefix;
        next();
      });
    }], function(err) {
      if(err) {
        return callback(err);
      }
      callback();
  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TransactionService.prototype._updateMempool = function(tx, action) {
  if (action === 'del') {
    return this._mempool.del(tx.id);
  }
  var val, key;
  if (_.isString(tx)) {
    val = false;
    key = tx;
  } else {
    val = tx;
    key = tx.id;
  }
  return this._mempool.set(key, val);
};

TransactionService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;
  var action = 'put';
  if (!connectBlock) {
    action = 'del';
  }

  var operations = [];

  this.currentTransactions = {};

  async.series([
    function(next) {
      self.node.services.timestamp.getTimestamp(block.hash, function(err, timestamp) {
        if(err) {
          return next(err);
        }
        block.__timestamp = timestamp;
        next();
      });
    }, function(next) {
      async.eachSeries(block.transactions, function(tx, next) {
        self._updateMempool(tx, action);
        tx.__timestamp = block.__timestamp;
        tx.__height = block.__height;

        self._getInputValues(tx, function(err, inputValues) {
          if(err) {
            return next(err);
          }
          tx.__inputValues = inputValues;
          self.currentTransactions[tx.id] = tx;

          operations.push({
            type: action,
            key: self._encodeTransactionKey(tx.id),
            value: self._encodeTransactionValue(tx)
          });
          next();
        });
      }, function(err) {
        if(err) {
          return next(err);
        }
        next();
      });
    }], function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, operations);
    });

};

TransactionService.prototype._getInputValues = function(tx, callback) {
  var self = this;

  if (tx.isCoinbase()) {
    return callback(null, []);
  }

  async.mapLimit(tx.inputs, this.concurrency, function(input, next) {
    self.getTransaction(input.prevTxId.toString('hex'), {}, function(err, prevTx) {
      if(err) {
        return next(err);
      }
      if (!prevTx.outputs[input.outputIndex]) {
        return next(new Error('Input did not have utxo.'));
      }
      var satoshis = prevTx.outputs[input.outputIndex].satoshis;
      next(null, satoshis);
    });
  }, callback);
};

TransactionService.prototype.getTransaction = function(txid, options, callback) {
  var self = this;

  if(self.currentTransactions[txid]) {
    return setImmediate(function() {
      callback(null, self.currentTransactions[txid]);
    });
  }

  var memPoolTx = self._mempool.get(txid);
  if (options && options.queryMempool && memPoolTx) {
    return setImmediate(function() {
      callback(null, memPoolTx);
    });
  } else if (memPoolTx === false) {
    self.node.services.bitcoind.getTransaction(txid, function(err, tx) {
      if(err) {
        return callback(err);
      }
      self._updateMempool(tx);
      callback(null, tx);
    });
  }

  var key = self._encodeTransactionKey(txid);

  self.node.services.db.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    var tx = self._decodeTransactionValue(buffer);
    callback(null, tx);
  });
};

TransactionService.prototype._encodeTransactionKey = function(txid) {
  return Buffer.concat([this.prefix, new Buffer(txid, 'hex')]);
};

TransactionService.prototype._decodeTransactionKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

TransactionService.prototype._encodeTransactionValue = function(transaction) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(transaction.__height);

  var timestampBuffer = new Buffer(8);
  timestampBuffer.writeDoubleBE(transaction.__timestamp);

  var inputValues = transaction.__inputValues;
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }

  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length * 8);

  return new Buffer.concat([heightBuffer, timestampBuffer,
    inputValuesLengthBuffer, inputValuesBuffer, transaction.toBuffer()]);
};

TransactionService.prototype._decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();

  var timestamp = buffer.readDoubleBE(4);

  var inputValues = [];
  var inputValuesLength = buffer.readUInt16BE(12);
  for(var i = 0; i < inputValuesLength / 8; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 14));
  }
  var transaction = new bitcore.Transaction(buffer.slice(inputValues.length * 8 + 14));
  transaction.__height = height;
  transaction.__inputValues = inputValues;
  transaction.__timestamp = timestamp;
  return transaction;
};

module.exports = TransactionService;
