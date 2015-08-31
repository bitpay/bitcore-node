'use strict';

var util = require('util');
var fs = require('fs');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var $ = bitcore.util.preconditions;
var index = require('../');
var errors = index.errors;
var log = index.log;
var Transaction = require('../transaction');
var Module = require('../module');

/**
 * Represents the current state of the bitcoin blockchain transaction data. Other modules
 * can extend the data that is indexed by implementing a `blockHandler` method.
 *
 * @param {Object} options
 * @param {String} options.datadir - The bitcoin data directory
 * @param {Node} options.node - A reference to the node
 */
function DB(options) {
  if (!(this instanceof DB)) {
    return new DB(options);
  }
  if (!options) {
    options = {};
  }

  Module.call(this, options);

  $.checkState(this.node.network, 'Node is expected to have a "network" property');
  this.network = this.node.network;

  this._setDataPath();

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

util.inherits(DB, Module);

DB.dependencies = ['bitcoind'];

DB.prototype._setDataPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  var regtest = Networks.get('regtest');
  if (this.node.network === Networks.livenet) {
    this.dataPath = this.node.datadir + '/bitcore-node.db';
  } else if (this.node.network === Networks.testnet) {
    this.dataPath = this.node.datadir + '/testnet3/bitcore-node.db';
  } else if (this.node.network === regtest) {
    this.dataPath = this.node.datadir + '/regtest/bitcore-node.db';
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

DB.prototype.start = function(callback) {
  if (!fs.existsSync(this.dataPath)) {
    mkdirp.sync(this.dataPath);
  }
  this.store = levelup(this.dataPath, { db: this.levelupStore });
  this.node.modules.bitcoind.on('tx', this.transactionHandler.bind(this));
  this.emit('ready');
  log.info('Bitcoin Database Ready');
  setImmediate(callback);
};

DB.prototype.stop = function(callback) {
  // TODO Figure out how to call this.store.close() without issues
  setImmediate(callback);
};

DB.prototype.getInfo = function(callback) {
  var self = this;
  setImmediate(function() {
    var info = self.node.bitcoind.getInfo();
    callback(null, info);
  });
};

DB.prototype.transactionHandler = function(txInfo) {
  var tx = Transaction().fromBuffer(txInfo.buffer);
  for (var i = 0; i < this.subscriptions.transaction.length; i++) {
    this.subscriptions.transaction[i].emit('transaction', {
      rejected: !txInfo.mempool,
      tx: tx
    });
  }
};

/**
 * Closes the underlying store database
 * @param  {Function} callback - A function that accepts: Error
 */
DB.prototype.close = function(callback) {
  this.store.close(callback);
};

DB.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getTransaction', this, this.getTransaction, 2],
    ['getTransactionWithBlockInfo', this, this.getTransactionWithBlockInfo, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1]
  ];
  return methods;
};

DB.prototype.getBlock = function(hash, callback) {
  this.node.modules.bitcoind.getBlock(hash, function(err, blockData) {
    if (err) {
      return callback(err);
    }
    callback(null, Block.fromBuffer(blockData));
  });
};

DB.prototype.getTransaction = function(txid, queryMempool, callback) {
  this.node.modules.bitcoind.getTransaction(txid, queryMempool, function(err, txBuffer) {
    if (err) {
      return callback(err);
    }
    if (!txBuffer) {
      return callback(new errors.Transaction.NotFound());
    }

    callback(null, Transaction().fromBuffer(txBuffer));
  });
};

DB.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  this.node.modules.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, obj) {
    if (err) {
      return callback(err);
    }

    var tx = Transaction().fromBuffer(obj.buffer);
    tx.__height = obj.height;
    tx.__timestamp = obj.timestamp;

    callback(null, tx);
  });
};

DB.prototype.sendTransaction = function(tx, callback) {
  if (tx instanceof Transaction) {
    tx = tx.toString();
  }
  $.checkArgument(typeof tx === 'string', 'Argument must be a hex string or Transaction');

  try {
    var txid = this.node.modules.bitcoind.sendTransaction(tx);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

DB.prototype.estimateFee = function(blocks, callback) {
  var self = this;
  setImmediate(function() {
    callback(null, self.node.modules.bitcoind.estimateFee(blocks));
  });
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
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
};

/**
 * Will give the previous hash for a block.
 * @param {String} blockHash
 * @param {Function} callback
 */
DB.prototype.getPrevHash = function(blockHash, callback) {
  var blockIndex = this.node.modules.bitcoind.getBlockIndex(blockHash);
  setImmediate(function() {
    if (blockIndex) {
      callback(null, blockIndex.prevHash);
    } else {
      callback(new Error('Could not get prevHash, block not found'));
    }
  });
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
    if (err instanceof levelup.errors.NotFoundError) {
      return callback(null, {});
    } else if (err) {
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
 * Connects a block to the database and add indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
DB.prototype.connectBlock = function(block, callback) {
  log.debug('DB handling new chain block');
  this.runAllBlockHandlers(block, true, callback);
};

/**
 * Disconnects a block from the database and removes indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
DB.prototype.disconnectBlock = function(block, callback) {
  log.debug('DB removing chain block');
  this.runAllBlockHandlers(block, false, callback);
};

/**
 * Will collect all database operations for a block from other modules
 * and save to the database.
 * @param {Block} block - The bitcore block
 * @param {Boolean} add - If the block is being added/connected or removed/disconnected
 * @param {Function} callback
 */
DB.prototype.runAllBlockHandlers = function(block, add, callback) {
  var self = this;
  var operations = [];

  // Notify block subscribers
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('block', block.hash);
  }

  async.eachSeries(
    this.node.modules,
    function(mod, next) {
      mod.blockHandler.call(mod, block, add, function(err, ops) {
        if (err) {
          return next(err);
        }
        if (ops) {
          operations = operations.concat(ops);
        }
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

module.exports = DB;
