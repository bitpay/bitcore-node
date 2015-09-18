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

DB.PREFIXES = {
  BLOCKS: new Buffer('01', 'hex')
};

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
      self.getBlock(metadata.tip, function(err, tip) {
        if(err) {
          log.warn(
            'Database is in an inconsistent state, a reindex is needed. Could not get current tip:',
            metadata.tip
          );
          return callback(err);
        }
        self.tip = tip;
        var blockIndex = self.node.services.bitcoind.getBlockIndex(self.tip.hash);
        if (!blockIndex) {
          return callback(new Error('Could not get height for tip.'));
        }
        self.tip.__height = blockIndex.height;
        self.sync();
        self.emit('ready');
        setImmediate(callback);
      });
    }
  });

};

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
    ['getBlockHashesByTimestamp', this, this.getBlockHashesByTimestamp, 2],
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

/**
 * get block hashes between two timestamps
 * @param {Number} high - high timestamp, in seconds, inclusive
 * @param {Number} low - low timestamp, in seconds, inclusive
 * @param {Function} callback
 */
DB.prototype.getBlockHashesByTimestamp = function(high, low, callback) {
  var self = this;
  var hashes = [];

  try {
    var lowKey = this._encodeBlockIndexKey(low);
    var highKey = this._encodeBlockIndexKey(high);
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
    hashes.push(self._decodeBlockIndexValue(data.value));
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

    callback(null, hashes);
  });

  return stream;
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

  var metadata = {
    tip: self.tip ? self.tip.hash : null
  };

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

DB.prototype.runAllMempoolIndexes = function(callback) {
  async.eachSeries(
    this.node.services,
    function(service, next) {
      if (service.resetMempoolIndex) {
        service.resetMempoolIndex(next);
      } else {
        setImmediate(next);
      }
    },
    callback
  );
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

  // Update block index
  operations.push({
    type: add ? 'put' : 'del',
    key: this._encodeBlockIndexKey(block.header.timestamp),
    value: this._encodeBlockIndexValue(block.hash)
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

DB.prototype._encodeBlockIndexValue = function(hash) {
  return new Buffer(hash, 'hex');
};

DB.prototype._decodeBlockIndexValue = function(value) {
  return value.toString('hex');
};

/**
 * This function will find the common ancestor between the current chain and a forked block,
 * by moving backwards from the forked block until it meets the current chain.
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

      // TODO: expose prevHash as a string from bitcore
      var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

      if (prevHash === self.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.tip.__height + 1;

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
      self.runAllMempoolIndexes(function(err) {
        if (err) {
          Error.captureStackTrace(err);
          return self.node.emit('error', err);
        }

        self.bitcoindSyncing = false;
        self.node.emit('synced');
      });
    } else {
      self.bitcoindSyncing = false;
    }

  });

};

module.exports = DB;
