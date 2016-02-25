'use strict';

var util = require('util');
var fs = require('fs');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var $ = bitcore.util.preconditions;
var index = require('../');
var errors = index.errors;
var log = index.log;
var Transaction = require('../transaction');
var Service = require('../service');

/**
 * This service synchronizes a leveldb database with bitcoin block chain by connecting and
 * disconnecting blocks to build new indexes that can be queried. Other services can extend
 * the data that is indexed by implementing a `blockHandler` method.
 *
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 * @param {Node} options.store - A levelup backend store
 */
function DB(options) {
  /* jshint maxstatements: 20 */

  if (!(this instanceof DB)) {
    return new DB(options);
  }
  if (!options) {
    options = {};
  }

  Service.call(this, options);

  // Used to keep track of the version of the indexes
  // to determine during an upgrade if a reindex is required
  this.version = 3;

  this.tip = null;
  this.genesis = null;

  $.checkState(this.node.network, 'Node is expected to have a "network" property');
  this.network = this.node.network;

  this._setDataPath();

  this.maxOpenFiles = options.maxOpenFiles || DB.DEFAULT_MAX_OPEN_FILES;
  this.maxTransactionLimit = options.maxTransactionLimit || DB.MAX_TRANSACTION_LIMIT;

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.retryInterval = 60000;

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

util.inherits(DB, Service);

DB.dependencies = ['bitcoind'];

DB.PREFIX_SIZE = 1;
DB.PREFIXES = {
  VERSION: new Buffer('ff', 'hex'),
  BLOCKS: new Buffer('01', 'hex'),
  TIP: new Buffer('04', 'hex')
};

// The maximum number of transactions to query at once
// Used for populating previous inputs
DB.MAX_TRANSACTION_LIMIT = 5;

// The default maxiumum number of files open for leveldb
DB.DEFAULT_MAX_OPEN_FILES = 600;

/**
 * This function will set `this.dataPath` based on `this.node.network`.
 * @private
 */
DB.prototype._setDataPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  if (this.node.network === Networks.livenet) {
    this.dataPath = this.node.datadir + '/bitcore-node.db';
  } else if (this.node.network === Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      this.dataPath = this.node.datadir + '/regtest/bitcore-node.db';
    } else {
      this.dataPath = this.node.datadir + '/testnet3/bitcore-node.db';
    }
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

DB.prototype._checkVersion = function(callback) {
  var self = this;
  var options = {
    keyEncoding: 'binary',
    valueEncoding: 'binary'
  };
  self.store.get(DB.PREFIXES.TIP, options, function(err) {
    if (err instanceof levelup.errors.NotFoundError) {
      // The database is brand new and doesn't have a tip stored
      // we can skip version checking
      return callback();
    } else if (err) {
      return callback(err);
    }
    self.store.get(DB.PREFIXES.VERSION, options, function(err, buffer) {
      var version;
      if (err instanceof levelup.errors.NotFoundError) {
        // The initial version (1) of the database didn't store the version number
        version = 1;
      } else if (err) {
        return callback(err);
      } else {
        version = buffer.readUInt32BE();
      }
      if (self.version !== version) {
        var helpUrl = 'https://github.com/bitpay/bitcore-node/blob/master/docs/services/db.md#how-to-reindex';
        return callback(new Error(
          'The version of the database "' + version + '" does not match the expected version "' +
            self.version + '". A recreation of "' + self.dataPath + '" (can take several hours) is ' +
            'required or to switch versions of software to match. Please see ' + helpUrl +
            ' for more information.'
        ));
      }
      callback();
    });
  });
};

DB.prototype._setVersion = function(callback) {
  var versionBuffer = new Buffer(new Array(4));
  versionBuffer.writeUInt32BE(this.version);
  this.store.put(DB.PREFIXES.VERSION, versionBuffer, callback);
};

/**
 * Called by Node to start the service.
 * @param {Function} callback
 */
DB.prototype.start = function(callback) {

  var self = this;
  if (!fs.existsSync(this.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);
  this.store = levelup(this.dataPath, { db: this.levelupStore, maxOpenFiles: this.maxOpenFiles });
  this.node.services.bitcoind.on('tx', this.transactionHandler.bind(this));

  this.once('ready', function() {
    log.info('Bitcoin Database Ready');

    // Notify that there is a new tip
    self.node.services.bitcoind.on('tip', function(height) {
      if(!self.node.stopping) {
        self.sync();
      }
    });
  });

  async.series([
    function(next) {
      self._checkVersion(next);
    },
    function(next) {
      self._setVersion(next);
    }
  ], function(err) {
    if (err) {
      return callback(err);
    }
    self.loadTip(function(err) {
      if (err) {
        return callback(err);
      }

      self.sync();
      self.emit('ready');
      setImmediate(callback);
    });
  });
};

/**
 * Called by Node to stop the service
 * @param {Function} callback
 */
DB.prototype.stop = function(callback) {
  var self = this;

  // Wait until syncing stops and all db operations are completed before closing leveldb
  async.whilst(function() {
    return self.bitcoindSyncing;
  }, function(next) {
    setTimeout(next, 10);
  }, function() {
    self.store.close(callback);
  });
};

/**
 * Will give information about the database from bitcoin.
 * @param {Function} callback
 */
DB.prototype.getInfo = function(callback) {
  var self = this;
  setImmediate(function() {
    var info = self.node.bitcoind.getInfo();
    callback(null, info);
  });
};

/**
 * Closes the underlying store database
 * @param {Function} callback
 */
DB.prototype.close = function(callback) {
  this.store.close(callback);
};

/**
 * This function is responsible for emitting `db/transaction` events.
 * @param {Object} txInfo - The data from the bitcoind.on('tx') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {Boolean} txInfo.mempool - If the transaction was accepted in the mempool
 * @param {String} txInfo.hash - The hash of the transaction
 */
DB.prototype.transactionHandler = function(txInfo) {
  var tx = Transaction().fromBuffer(txInfo.buffer);
  for (var i = 0; i < this.subscriptions.transaction.length; i++) {
    this.subscriptions.transaction[i].emit('db/transaction', {
      rejected: !txInfo.mempool,
      tx: tx
    });
  }
};

/**
 * Called by Node to determine the available API methods.
 */
DB.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getBlockInfoByTimestamp', this, this.getBlockInfoByTimestamp, 2],
    ['getTransaction', this, this.getTransaction, 2],
    ['getTransactionWithBlockInfo', this, this.getTransactionWithBlockInfo, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1]
  ];
  return methods;
};

DB.prototype.loadTip = function(callback) {
  var self = this;

  var options = {
    keyEncoding: 'binary',
    valueEncoding: 'binary'
  };

  self.store.get(DB.PREFIXES.TIP, options, function(err, tipData) {
    if(err && err instanceof levelup.errors.NotFoundError) {
      self.tip = self.genesis;
      self.tip.__height = 0;
      self.connectBlock(self.genesis, self.genesis.toBuffer().length, function(err) {
        if(err) {
          return callback(err);
        }

        self.emit('addblock', self.genesis);
        callback();
      });
      return;
    } else if(err) {
      return callback(err);
    }

    var hash = tipData.toString('hex');

    var times = 0;
    async.retry({times: 3, interval: self.retryInterval}, function(done) {
      self.getBlock(hash, function(err, tip) {
        if(err) {
          times++;
          log.warn('Bitcoind does not have our tip (' + hash + '). Bitcoind may have crashed and needs to catch up.');
          if(times < 3) {
            log.warn('Retrying in ' + (self.retryInterval / 1000) + ' seconds.');
          }
          return done(err);
        }

        done(null, tip);
      });
    }, function(err, tip) {
      if(err) {
        log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
        log.warn('Please reindex your database.');
        return callback(err);
      }

      self.tip = tip;
      var blockIndex = self.node.services.bitcoind.getBlockIndex(self.tip.hash);
      if(!blockIndex) {
        return callback(new Error('Could not get height for tip.'));
      }
      self.tip.__height = blockIndex.height;
      callback();
    });
  });
};

/**
 * Will get a block from bitcoind and give a Bitcore Block
 * @param {String|Number} hash - A block hash or block height
 */
DB.prototype.getBlock = function(hash, callback) {
  this.node.services.bitcoind.getBlock(hash, function(err, blockBuffer) {
    if (err) {
      return callback(err);
    }
    callback(null, Block.fromBuffer(blockBuffer));
  });
};

/**
 * Get block hashes between two timestamps
 * @param {Number} high - high timestamp, in seconds, inclusive
 * @param {Number} low - low timestamp, in seconds, inclusive
 * @param {Function} callback
 */
DB.prototype.getBlockInfoByTimestamp = function(high, low, callback) {
  var self = this;
  var blockInfo = [];
  var lowKey;
  var highKey;

  try {
    lowKey = this._encodeBlockIndexKey(low);
    highKey = this._encodeBlockIndexKey(high);
  } catch(e) {
    return callback(e);
  }

  var stream = this.store.createReadStream({
    gte: lowKey,
    lte: highKey,
    reverse: true,
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    var info = self._decodeBlockIndexValue(data.value);
    var timestamp = self._decodeBlockIndexKey(data.key);
    info.timestamp = timestamp;
    blockInfo.push(info);
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
    callback(null, blockInfo);
  });

  return stream;
};

/**
 * Will give a Bitcore Transaction from bitcoind by txid
 * @param {String} txid - A transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
DB.prototype.getTransaction = function(txid, queryMempool, callback) {
  this.node.services.bitcoind.getTransaction(txid, queryMempool, function(err, txBuffer) {
    if (err) {
      return callback(err);
    }
    if (!txBuffer) {
      return callback(new errors.Transaction.NotFound());
    }

    callback(null, Transaction().fromBuffer(txBuffer));
  });
};

/**
 * Will give a Bitcore Transaction and populated information about the block included.
 * @param {String} txid - A transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
DB.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  this.node.services.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, obj) {
    if (err) {
      return callback(err);
    }

    var tx = Transaction().fromBuffer(obj.buffer);
    tx.__blockHash = obj.blockHash;
    tx.__height = obj.height;
    tx.__timestamp = obj.timestamp;

    callback(null, tx);
  });
};

/**
 * Will send a transaction to the Bitcoin network.
 * @param {Transaction} tx - An instance of a Bitcore Transaction
 * @param {Function} callback
 */
DB.prototype.sendTransaction = function(tx, callback) {
  var txString;
  if (tx instanceof Transaction) {
    txString = tx.serialize();
  } else {
    txString = tx;
  }

  try {
    var txid = this.node.services.bitcoind.sendTransaction(txString);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

/**
 * Will estimate fees for a transaction and give a result in
 * satoshis per kilobyte. Similar to the bitcoind estimateFee method.
 * @param {Number} blocks - The number of blocks for the transaction to be included.
 * @param {Function} callback
 */
DB.prototype.estimateFee = function(blocks, callback) {
  var self = this;
  setImmediate(function() {
    callback(null, self.node.services.bitcoind.estimateFee(blocks));
  });
};

/**
 * Called by the Bus to determine the available events.
 */
DB.prototype.getPublishEvents = function() {
  return [
    {
      name: 'db/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'db/block',
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
  var blockIndex = this.node.services.bitcoind.getBlockIndex(blockHash);
  setImmediate(function() {
    if (blockIndex) {
      callback(null, blockIndex.prevHash);
    } else {
      callback(new Error('Could not get prevHash, block not found'));
    }
  });
};

/**
 * Connects a block to the database and add indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
DB.prototype.connectBlock = function(block, blockBytes, callback) {
  log.debug('DB handling new chain block');
  this.runAllBlockHandlers(block, blockBytes, true, callback);
};

/**
 * Disconnects a block from the database and removes indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
DB.prototype.disconnectBlock = function(block, blockBytes, callback) {
  log.debug('DB removing chain block');
  this.runAllBlockHandlers(block, blockBytes, false, callback);
};

/**
 * Will collect all database operations for a block from other services that implement
 * `blockHandler` methods and then save operations to the database.
 * @param {Block} block - The bitcore block
 * @param {Boolean} add - If the block is being added/connected or removed/disconnected
 * @param {Function} callback
 */
DB.prototype.runAllBlockHandlers = function(block, blockBytes, add, callback) {
  var self = this;
  var operations = [];

  // Notify block subscribers
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('db/block', block.hash);
  }

  // Update tip
  var tipHash = add ? new Buffer(block.hash, 'hex') : BufferUtil.reverse(block.header.prevHash);
  operations.push({
    type: 'put',
    key: DB.PREFIXES.TIP,
    value: tipHash
  });

  var coinbaseScriptBuffer = block.transactions[0].inputs[0]._scriptBuffer;

  // Update block index
  operations.push({
    type: add ? 'put' : 'del',
    key: this._encodeBlockIndexKey(block.header.timestamp),
    value: this._encodeBlockIndexValue({
      hash: block.hash,
      transactionCount: block.transactions.length,
      bytes: blockBytes,
      coinbaseScriptBuffer: coinbaseScriptBuffer,
      height: block.__height
    })
  });

  async.eachSeries(
    this.node.services,
    function(mod, next) {
      if(mod.blockHandler) {
        $.checkArgument(typeof mod.blockHandler === 'function', 'blockHandler must be a function');

        mod.blockHandler.call(mod, block, add, function(err, ops) {
          if (err) {
            return next(err);
          }
          if (ops) {
            $.checkArgument(Array.isArray(ops), 'blockHandler for ' + mod.name + ' returned non-array');
            operations = operations.concat(ops);
          }
          next();
        });
      } else {
        setImmediate(next);
      }
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

DB.prototype._encodeBlockIndexKey = function(timestamp) {
  $.checkArgument(timestamp >= 0 && timestamp <= 4294967295, 'timestamp out of bounds');
  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp);
  return Buffer.concat([DB.PREFIXES.BLOCKS, timestampBuffer]);
};

DB.prototype._decodeBlockIndexKey = function(buffer) {
  var timestamp = buffer.readUInt32BE(DB.PREFIX_SIZE);
  return timestamp;
};

DB.prototype._encodeBlockIndexValue = function(values) {
  var transactionCountBuffer = new Buffer(new Array(4));
  transactionCountBuffer.writeUInt32BE(values.transactionCount);
  var bytesBuffer = new Buffer(new Array(8));
  bytesBuffer.writeDoubleBE(values.bytes);
  var heightBuffer = new Buffer(new Array(4));
  heightBuffer.writeUInt32BE(values.height);
  return Buffer.concat([
    new Buffer(values.hash, 'hex'),
    heightBuffer,
    transactionCountBuffer,
    bytesBuffer,
    values.coinbaseScriptBuffer
  ]);
};

DB.prototype._decodeBlockIndexValue = function(value) {
  var blockHash = value.slice(0, 32).toString('hex');
  var height = value.readUInt32BE(32);
  var transactionCount = value.readUInt32BE(36);
  var bytes = value.readDoubleBE(40);
  var coinbaseScriptBuffer = value.slice(48, value.length);
  return {
    height: height,
    hash: blockHash,
    transactionCount: transactionCount,
    bytes: bytes,
    coinbaseScriptBuffer: coinbaseScriptBuffer
  };
};

/**
 * This function will find the common ancestor between the current chain and a forked block,
 * by moving backwards on both chains until there is a meeting point.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
DB.prototype.findCommonAncestor = function(block, done) {

  var self = this;

  var mainPosition = self.tip.hash;
  var forkPosition = block.hash;

  var mainHashesMap = {};
  var forkHashesMap = {};

  mainHashesMap[mainPosition] = true;
  forkHashesMap[forkPosition] = true;

  var commonAncestor = null;

  async.whilst(
    function() {
      return !commonAncestor;
    },
    function(next) {

      if(mainPosition) {
        var mainBlockIndex = self.node.services.bitcoind.getBlockIndex(mainPosition);
        if(mainBlockIndex && mainBlockIndex.prevHash) {
          mainHashesMap[mainBlockIndex.prevHash] = true;
          mainPosition = mainBlockIndex.prevHash;
        } else {
          mainPosition = null;
        }
      }

      if(forkPosition) {
        var forkBlockIndex = self.node.services.bitcoind.getBlockIndex(forkPosition);
        if(forkBlockIndex && forkBlockIndex.prevHash) {
          forkHashesMap[forkBlockIndex.prevHash] = true;
          forkPosition = forkBlockIndex.prevHash;
        } else {
          forkPosition = null;
        }
      }

      if(forkPosition && mainHashesMap[forkPosition]) {
        commonAncestor = forkPosition;
      }

      if(mainPosition && forkHashesMap[mainPosition]) {
        commonAncestor = mainPosition;
      }

      if(!mainPosition && !forkPosition) {
        return next(new Error('Unknown common ancestor'));
      }

      setImmediate(next);
    },
    function(err) {
      done(err, commonAncestor);
    }
  );
};

/**
 * This function will attempt to rewind the chain to the common ancestor
 * between the current chain and a forked block.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
DB.prototype.syncRewind = function(block, done) {

  var self = this;

  self.findCommonAncestor(block, function(err, ancestorHash) {
    if (err) {
      return done(err);
    }
    log.warn('Reorg common ancestor found:', ancestorHash);
    // Rewind the chain to the common ancestor
    async.whilst(
      function() {
        // Wait until the tip equals the ancestor hash
        return self.tip.hash !== ancestorHash;
      },
      function(removeDone) {

        var tip = self.tip;

        // TODO: expose prevHash as a string from bitcore
        var prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex');

        self.getBlock(prevHash, function(err, previousTip) {
          if (err) {
            removeDone(err);
          }

          // Undo the related indexes for this block
          self.disconnectBlock(tip, tip.toBuffer().length, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
            previousTip.__height = self.tip.__height - 1;
            self.tip = previousTip;
            self.emit('removeblock', tip);
            removeDone();
          });

        });

      }, done
    );
  });
};

/**
 * This function will synchronize additional indexes for the chain based on
 * the current active chain in the bitcoin daemon. In the event that there is
 * a reorganization in the daemon, the chain will rewind to the last common
 * ancestor and then resume syncing.
 */
DB.prototype.sync = function() {
  var self = this;

  if (self.bitcoindSyncing || self.node.stopping || !self.tip) {
    return;
  }

  self.bitcoindSyncing = true;

  var height;

  async.whilst(function() {
    height = self.tip.__height;
    return height < self.node.services.bitcoind.height && !self.node.stopping;
  }, function(done) {
    self.node.services.bitcoind.getBlock(height + 1, function(err, blockBuffer) {
      if (err) {
        return done(err);
      }

      var block = Block.fromBuffer(blockBuffer);
      var blockBytes = blockBuffer.length;

      // TODO: expose prevHash as a string from bitcore
      var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

      if (prevHash === self.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.tip.__height + 1;

        // Create indexes
        self.connectBlock(block, blockBytes, function(err) {
          if (err) {
            return done(err);
          }
          self.tip = block;
          log.debug('Chain added block to main chain');
          self.emit('addblock', block);
          setImmediate(done);
        });
      } else {
        // This block doesn't progress the current tip, so we'll attempt
        // to rewind the chain to the common ancestor of the block and
        // then we can resume syncing.
        log.warn('Beginning reorg! Current tip: ' + self.tip.hash + '; New tip: ' + block.hash);
        self.syncRewind(block, function(err) {
          if(err) {
            return done(err);
          }

          log.warn('Reorg complete. New tip is ' + self.tip.hash);
          done();
        });
      }
    });
  }, function(err) {
    if (err) {
      Error.captureStackTrace(err);
      return self.node.emit('error', err);
    }

    if(self.node.stopping) {
      self.bitcoindSyncing = false;
      return;
    }

    if (self.node.services.bitcoind.isSynced()) {
      self.bitcoindSyncing = false;
      self.node.emit('synced');
    } else {
      self.bitcoindSyncing = false;
    }

  });

};

module.exports = DB;
