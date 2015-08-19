'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var bitcore = require('bitcore');
var Block = bitcore.Block;
var $ = bitcore.util.preconditions;
var index = require('./');
var errors = index.errors;
var log = index.log;
var Transaction = require('./transaction');

function DB(options) {
  /* jshint maxstatements: 30 */
  /* jshint maxcomplexity: 20 */

  if (!(this instanceof DB)) {
    return new DB(options);
  }
  if(!options) {
    options = {};
  }

  this.coinbaseAmount = options.coinbaseAmount || 50 * 1e8;

  var levelupStore = leveldown;

  if(options.store) {
    levelupStore = options.store;
  } else if(!options.path) {
    throw new Error('Please include database path in options');
  }

  this.store = levelup(options.path, { db: levelupStore });
  this.txPrefix = options.txPrefix || DB.PREFIXES.TX;
  this.prevHashPrefix = options.prevHashPrefix || DB.PREFIXES.PREV_HASH;
  this.blockPrefix = options.blockPrefix || DB.PREFIXES.BLOCK;
  this.dataPrefix = options.dataPrefix || DB.PREFIXES.DATA;
  this.weightPrefix = options.weightPrefix || DB.PREFIXES.WEIGHT;
  this.Transaction = Transaction;

  this.coinbaseAddress = options.coinbaseAddress;
  this.coinbaseAmount = options.coinbaseAmount || 50 * 1e8;
  this.Transaction = Transaction;

  this.network = bitcore.Networks.get(options.network) || bitcore.Networks.testnet;

  this.node = options.node;

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

DB.PREFIXES = {
  TX: 'tx',
  PREV_HASH: 'ph',
  BLOCK: 'blk',
  DATA: 'data',
  WEIGHT: 'wt'
};

util.inherits(DB, EventEmitter);

DB.prototype.initialize = function() {
  this.emit('ready');
};

DB.prototype.start = function(callback) {
  this.node.bitcoind.on('tx', this.transactionHandler.bind(this));
  this.emit('ready');
  setImmediate(callback);
};

DB.prototype.stop = function(callback) {
  // TODO Figure out how to call this.store.close() without issues
  setImmediate(callback);
};

DB.prototype.getDefaultModules = function() {
  return [AddressModule, InsightAPIModule];
};

DB.prototype.getBlock = function(hash, callback) {
  var self = this;

  // get block from bitcoind
  this.node.bitcoind.getBlock(hash, function(err, blockData) {
    if(err) {
      return callback(err);
    }
    callback(null, Block.fromBuffer(blockData));
  });
};

DB.prototype.getPrevHash = function(blockHash, callback) {
  var blockIndex = this.node.bitcoind.getBlockIndex(blockHash);
  setImmediate(function() {
    if (blockIndex) {
      callback(null, blockIndex.prevHash);
    } else {
      callback(new Error('Could not get prevHash, block not found'));
    }
  });
};

DB.prototype.putBlock = function(block, callback) {
  // block is already stored in bitcoind
  setImmediate(callback);
};

DB.prototype.getTransaction = function(txid, queryMempool, callback) {
  this.node.bitcoind.getTransaction(txid, queryMempool, function(err, txBuffer) {
    if(err) {
      return callback(err);
    }
    if(!txBuffer) {
      return callback(new errors.Transaction.NotFound());
    }

    callback(null, Transaction().fromBuffer(txBuffer));
  });
};

DB.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  this.node.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, obj) {
    if(err) {
      return callback(err);
    }

    var tx = Transaction().fromBuffer(obj.buffer);
    tx.__height = obj.height;
    tx.__timestamp = obj.timestamp;

    callback(null, tx);
  });
};

DB.prototype.sendTransaction = function(tx, callback) {
  if(tx instanceof this.Transaction) {
    tx = tx.toString();
  }
  $.checkArgument(typeof tx === 'string', 'Argument must be a hex string or Transaction');

  try {
    var txid = this.node.bitcoind.sendTransaction(tx);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

DB.prototype.estimateFee = function(blocks, callback) {
  var self = this;

  setImmediate(function() {
    callback(null, self.node.bitcoind.estimateFee(blocks));
  });
};

DB.prototype.validateBlockData = function(block, callback) {
  // bitcoind does the validation
  setImmediate(callback);
};

DB.prototype._updatePrevHashIndex = function(block, callback) {
  // bitcoind has the previous hash for each block
  setImmediate(callback);
};

DB.prototype._updateWeight = function(hash, weight, callback) {
  // bitcoind has all work for each block
  setImmediate(callback);
};

/**
 * Saves metadata to the database
 * @param {Object} metadata - The metadata
 * @param {Function} callback - A function that accepts: Error
 */
DB.prototype.putMetadata = function(metadata, callback) {
  this.store.put('metadata', JSON.stringify(metadata), {}, callback);
};

/**
 * Retrieves metadata from the database
 * @param {Function} callback - A function that accepts: Error and Object
 */
DB.prototype.getMetadata = function(callback) {
  var self = this;

  self.store.get('metadata', {}, function(err, data) {
    if(err instanceof levelup.errors.NotFoundError) {
      return callback(null, {});
    } else if(err) {
      return callback(err);
    }

    var metadata;
    try {
      metadata = JSON.parse(data);
    } catch(e) {
      return callback(new Error('Could not parse metadata'));
    }

    callback(null, metadata);
  });
};

/**
 * Closes the underlying store database
 * @param  {Function} callback - A function that accepts: Error
 */
DB.prototype.close = function(callback) {
  this.store.close(callback);
};

DB.prototype.getOutputTotal = function(transactions, excludeCoinbase) {
  var totals = transactions.map(function(tx) {
    if(tx.isCoinbase() && excludeCoinbase) {
      return 0;
    } else {
      return tx._getOutputAmount();
    }
  });
  var grandTotal = totals.reduce(function(previousValue, currentValue) {
    return previousValue + currentValue;
  });
  return grandTotal;
};

DB.prototype.getInputTotal = function(transactions) {
  var totals = transactions.map(function(tx) {
    if(tx.isCoinbase()) {
      return 0;
    } else {
      return tx._getInputAmount();
    }
  });
  var grandTotal = totals.reduce(function(previousValue, currentValue) {
    return previousValue + currentValue;
  });
  return grandTotal;
};

DB.prototype._onChainAddBlock = function(block, callback) {
  log.debug('DB handling new chain block');

  this.blockHandler(block, true, callback);
};

DB.prototype._onChainRemoveBlock = function(block, callback) {
  log.debug('DB removing chain block');
  this.blockHandler(block, false, callback);
};

DB.prototype.blockHandler = function(block, add, callback) {
  var self = this;
  var operations = [];

  // Notify block subscribers
  for(var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('block', block.hash);
  }

  async.eachSeries(
    this.node.modules,
    function(bitcoreNodeModule, next) {
      bitcoreNodeModule.blockHandler.call(bitcoreNodeModule, block, add, function(err, ops) {
        if(err) {
          return next(err);
        }

        operations = operations.concat(ops);
        next();
      });
    },
    function(err) {
      if (err) {
        return callback(err);
      }

      log.debug('Updating the database with operations', operations);

      self.store.batch(operations, callback);
    }
  );
};

DB.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getTransaction', this, this.getTransaction, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1]
  ];
  return methods;
};

DB.prototype.getPublishEvents = function() {
  return [
    {
      name: 'transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];
};

DB.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
};

DB.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if(index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
};

DB.prototype.transactionHandler = function(txInfo) {
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);
  for(var i = 0; i < this.subscriptions.transaction.length; i++) {
    this.subscriptions.transaction[i].emit('transaction', {
      rejected: !txInfo.mempool,
      tx: tx
    });
  }
};

module.exports = DB;
