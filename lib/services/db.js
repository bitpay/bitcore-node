'use strict';

var util = require('util');
var fs = require('fs');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore');
var BufferUtil = bitcore.util.buffer;
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var $ = bitcore.util.preconditions;
var index = require('../');
var errors = index.errors;
var log = index.log;
var Transaction = require('../transaction');
var Service = require('../service');
var utils = require('../utils');

var MAX_STACK_DEPTH = 1000;

/**
 * Represents the current state of the bitcoin blockchain. Other services
 * can extend the data that is indexed by implementing a `blockHandler` method.
 *
 * @param {Object} options
 * @param {String} options.datadir - The bitcoin data directory
 * @param {Node} options.node - A reference to the node
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

  this.tip = null;
  this.genesis = null;

  $.checkState(this.node.network, 'Node is expected to have a "network" property');
  this.network = this.node.network;

  this._setDataPath();

  this.cache = {
    hashes: {}, // dictionary of hash -> prevHash
    chainHashes: {}
  };
  this.lastSavedMetadata = null;
  this.lastSavedMetadataThreshold = 0; // Set this during syncing for faster performance

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

util.inherits(DB, Service);

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
  var self = this;
  if (!fs.existsSync(this.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);
  this.store = levelup(this.dataPath, { db: this.levelupStore });
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

  // Does our database already have a tip?
  self.getMetadata(function(err, metadata) {
    if(err) {
      return callback(err);
    } else if(!metadata || !metadata.tip) {
      self.tip = self.genesis;
      self.tip.__height = 0;
      self.connectBlock(self.genesis, function(err) {
        if(err) {
          return callback(err);
        }

        self.emit('addblock', self.genesis);
        self.saveMetadata();
        self.sync();
        self.emit('ready');
        setImmediate(callback);

      });
    } else {
      metadata.tip = metadata.tip;
      self.getBlock(metadata.tip, function(err, tip) {
        if(err) {
          return callback(err);
        }

        self.tip = tip;
        self.tip.__height = metadata.tipHeight;
        self.cache = metadata.cache;
        self.sync();
        self.emit('ready');
        setImmediate(callback);

      });
    }
  });

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

/**
 * Closes the underlying store database
 * @param  {Function} callback - A function that accepts: Error
 */
DB.prototype.close = function(callback) {
  this.store.close(callback);
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
  this.node.services.bitcoind.getBlock(hash, function(err, blockData) {
    if (err) {
      return callback(err);
    }
    callback(null, Block.fromBuffer(blockData));
  });
};

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

DB.prototype.sendTransaction = function(tx, callback) {
  if (tx instanceof Transaction) {
    tx = tx.toString();
  }
  $.checkArgument(typeof tx === 'string', 'Argument must be a hex string or Transaction');

  try {
    var txid = this.node.services.bitcoind.sendTransaction(tx);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

DB.prototype.estimateFee = function(blocks, callback) {
  var self = this;
  setImmediate(function() {
    callback(null, self.node.services.bitcoind.estimateFee(blocks));
  });
};

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
 * Saves metadata to the database
 * @param {Function} callback - A function that accepts: Error
 */
DB.prototype.saveMetadata = function(callback) {
  var self = this;

  function defaultCallback(err) {
    if (err) {
      self.emit('error', err);
    }
  }

  callback = callback || defaultCallback;

  var threshold = self.lastSavedMetadataThreshold;
  if (self.lastSavedMetadata && Date.now() < self.lastSavedMetadata.getTime() + threshold) {
    return callback();
  }

  var metadata = {
    tip: self.tip ? self.tip.hash : null,
    tipHeight: self.tip && self.tip.__height ? self.tip.__height : 0,
    cache: self.cache
  };

  self.lastSavedMetadata = new Date();

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
 * Will collect all database operations for a block from other services
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
    this.node.services,
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

/**
 * Will get an array of hashes all the way to the genesis block for
 * the chain based on "block hash" as the tip.
 *
 * @param {String} block hash - a block hash
 * @param {Function} callback - A function that accepts: Error and Array of hashes
 */
DB.prototype.getHashes = function getHashes(tipHash, callback) {
  var self = this;

  $.checkArgument(utils.isHash(tipHash));

  var hashes = [];
  var depth = 0;

  function getHashAndContinue(err, hash) {
    /* jshint maxstatements: 20 */

    if (err) {
      return callback(err);
    }

    depth++;

    hashes.unshift(hash);

    if (hash === self.genesis.hash) {
      // Stop at the genesis block
      self.cache.chainHashes[tipHash] = hashes;

      callback(null, hashes);
    } else if(self.cache.chainHashes[hash]) {
      hashes.shift();
      hashes = self.cache.chainHashes[hash].concat(hashes);
      self.cache.chainHashes[tipHash] = hashes;
      if(hash !== tipHash) {
        delete self.cache.chainHashes[hash];
      }
      callback(null, hashes);
    } else {
      // Continue with the previous hash
      // check cache first
      var prevHash = self.cache.hashes[hash];
      if(prevHash) {
        // Don't let the stack get too deep. Otherwise we will crash.
        if(depth >= MAX_STACK_DEPTH) {
          depth = 0;
          return setImmediate(function() {
            getHashAndContinue(null, prevHash);
          });
        } else {
          return getHashAndContinue(null, prevHash);
        }
      } else {
        // do a db call if we don't have it
        self.getPrevHash(hash, function(err, prevHash) {
          if(err) {
            return callback(err);
          }

          return getHashAndContinue(null, prevHash);
        });
      }
    }
  }

  getHashAndContinue(null, tipHash);

};

/**
 * This function will find the common ancestor between the current chain and a forked block,
 * by moving backwards from the forked block until it meets the current chain.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
DB.prototype.findCommonAncestor = function(block, done) {

  var self = this;

  // The current chain of hashes will likely already be available in a cache.
  self.getHashes(self.tip.hash, function(err, currentHashes) {
    if (err) {
      done(err);
    }

    // Create a hash map for faster lookups
    var currentHashesMap = {};
    var length = currentHashes.length;
    for (var i = 0; i < length; i++) {
      currentHashesMap[currentHashes[i]] = true;
    }

    // TODO: expose prevHash as a string from bitcore
    var ancestorHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

    // We only need to go back until we meet the main chain for the forked block
    // and thus don't need to find the entire chain of hashes.

    while(ancestorHash && !currentHashesMap[ancestorHash]) {
      var blockIndex = self.node.services.bitcoind.getBlockIndex(ancestorHash);
      ancestorHash = blockIndex ? blockIndex.prevHash : null;
    }

    // Hash map is no-longer needed, quickly let
    // scavenging garbage collection know to cleanup
    currentHashesMap = null;

    if (!ancestorHash) {
      return done(new Error('Unknown common ancestor.'));
    }

    done(null, ancestorHash);

  });
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
          self.disconnectBlock(tip, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
            previousTip.__height = self.tip.__height - 1;
            self.tip = previousTip;
            self.saveMetadata();
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

  if (self.bitcoindSyncing) {
    return;
  }

  if (!self.tip) {
    return;
  }

  self.bitcoindSyncing = true;
  self.lastSavedMetadataThreshold = 30000;

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

      // TODO: expose prevHash as a string from bitcore
      var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

      if (prevHash === self.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.tip.__height + 1;

        // Update cache.hashes
        self.cache.hashes[block.hash] = prevHash;

        // Update cache.chainHashes
        self.getHashes(block.hash, function(err, hashes) {
          if (err) {
            return done(err);
          }
          // Create indexes
          self.connectBlock(block, function(err) {
            if (err) {
              return done(err);
            }
            self.tip = block;
            log.debug('Saving metadata');
            self.saveMetadata();
            log.debug('Chain added block to main chain');
            self.emit('addblock', block);
            setImmediate(done);
          });
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
      return;
    }

    self.bitcoindSyncing = false;
    self.lastSavedMetadataThreshold = 0;
    self.saveMetadata();

    // If bitcoind is completely synced
    if (self.node.services.bitcoind.isSynced()) {
      self.node.emit('synced');
    }

  });

};

module.exports = DB;
