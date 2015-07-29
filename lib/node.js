'use strict';

var async = require('async');
var Chain = require('./chain');
var Block = require('./block');
var DB = require('./db');
var chainlib = require('chainlib');
var fs = require('fs');
var BaseNode = chainlib.Node;
var util = require('util');
var mkdirp = require('mkdirp');
var log = chainlib.log;
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var genesis = require('./genesis.json');
var daemon = require('./daemon');
var Bus = require('./bus');

function Node(config) {
  BaseNode.call(this, config);
  this.testnet = config.testnet;
}

util.inherits(Node, BaseNode);

Node.prototype.openBus = function() {
  return new Bus({db: this.db});
};

Node.prototype._loadConfiguration = function(config) {
  var self = this;
  this._loadBitcoinConf(config);
  this._loadBitcoind(config);
  Node.super_.prototype._loadConfiguration.call(self, config);
};

Node.DEFAULT_DAEMON_CONFIG = 'whitelist=127.0.0.1\n' + 'txindex=1\n';

Node.prototype._loadBitcoinConf = function(config) {
  $.checkArgument(config.datadir, 'Please specify "datadir" in configuration options');
  var datadir = config.datadir.replace(/^~/, process.env.HOME);
  var configPath = datadir + '/bitcoin.conf';
  this.bitcoinConfiguration = {};

  if (!fs.existsSync(datadir)) {
    mkdirp.sync(datadir);
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, Node.DEFAULT_DAEMON_CONFIG);
  }

  var file = fs.readFileSync(configPath);
  var unparsed = file.toString().split('\n');
  for(var i = 0; i < unparsed.length; i++) {
    var line = unparsed[i];
    if (!line.match(/^\#/) && line.match(/\=/)) {
      var option = line.split('=');
      var value;
      if (!Number.isNaN(Number(option[1]))) {
        value = Number(option[1]);
      } else {
        value = option[1];
      }
      this.bitcoinConfiguration[option[0]] = value;
    }
  }

};

Node.prototype._loadBitcoind = function(config) {
  var bitcoindConfig = {};
  bitcoindConfig.datadir = config.datadir;
  bitcoindConfig.network = config.network;

  // start the bitcoind daemon
  this.bitcoind = daemon(bitcoindConfig);

};

/**
 * This function will find the common ancestor between the current chain and a forked block,
 * by moving backwards from the forked block until it meets the current chain.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
Node.prototype._syncBitcoindAncestor = function(block, done) {

  var self = this;

  // The current chain of hashes will likely already be available in a cache.
  self.chain.getHashes(self.chain.tip.hash, function(err, currentHashes) {
    if (err) {
      done(err);
    }

    // Create a hash map for faster lookups
    var currentHashesMap = {};
    var length = currentHashes.length;
    for (var i = 0; i < length; i++) {
      currentHashesMap[currentHashes[i]] = true;
    }

    var ancestorHash = block.prevHash;

    // We only need to go back until we meet the main chain for the forked block
    // and thus don't need to find the entire chain of hashes.

    async.whilst(function() {
      // Wait until the previous hash is in the current chain
      return ancestorHash && !currentHashesMap[ancestorHash];
    }, function(next) {
      self.bitcoind.getBlockIndex(ancestorHash, function(err, blockIndex) {
        if (err) {
          return next(err);
        }
        ancestorHash = blockIndex.prevHash;
        next();
      });
    }, function(err) {

      // Hash map is no-longer needed, quickly let
      // scavenging garbage collection know to cleanup
      currentHashesMap = null;

      if (err) {
        return done(err);
      } else if (!ancestorHash) {
        return done(new Error('Unknown common ancestor.'));
      }

      done(null, ancestorHash);
    });
  });
};

/**
 * This function will attempt to rewind the chain to the common ancestor
 * between the current chain and a forked block.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
Node.prototype._syncBitcoindRewind = function(block, done) {

  var self = this;

  self._syncBitcoindAncestor(block, function(err, ancestorHash) {

    // Rewind the chain to the common ancestor
    async.whilst(
      function() {
        // Wait until the tip equals the ancestor hash
        return self.chain.tip.hash !== ancestorHash;
      },
      function(removeDone) {

        var tip = self.chain.tip;

        self.getBlock(tip.prevHash, function(err, previousTip) {
          if (err) {
            removeDone(err);
          }

          // Undo the related indexes for this block
          self.db._onChainRemoveBlock(tip, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
            delete self.chain.tip.__transactions;
            previousTip.__height = self.chain.tip.__height - 1;
            self.chain.tip = previousTip;
            self.chain.saveMetadata();
            self.chain.emit('removeblock', tip);
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
Node.prototype._syncBitcoind = function() {
  var self = this;

  if (self.bitcoindSyncing) {
    return;
  }

  if (!self.chain.tip) {
    return;
  }

  self.bitcoindSyncing = true;

  log.info('Starting Bitcoind Sync');

  var height;

  async.whilst(function() {
    height = self.chain.tip.__height;
    return height < self.bitcoindHeight;
  }, function(done) {
    self.bitcoind.getBlock(height + 1, function(err, blockBuffer) {
      if (err) {
        return done(err);
      }
      var block = self.Block.fromBuffer(blockBuffer);
      if (block.prevHash === self.chain.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.chain.tip.__height + 1;

        // Update chain hashes
        self.chain.cache.hashes[block.hash] = block.prevHash;

        // Create indexes
        self.db._onChainAddBlock(block, function(err) {
          if (err) {
            return done(err);
          }
          delete self.chain.tip.__transactions;
          self.chain.tip = block;
          log.debug('Saving metadata');
          self.chain.saveMetadata();
          log.debug('Chain added block to main chain');
          self.chain.emit('addblock', block);
          done();
        });

      } else {

        // This block doesn't progress the current tip, so we'll attempt
        // to rewind the chain to the common ancestor of the block and
        // then we can resume syncing.
        self._syncBitcoindRewind(block, done);

      }
    });
  }, function(err) {
    log.info('Stopping Bitcoind Sync');
    self.bitcoindSyncing = false;
    if (err) {
      Error.captureStackTrace(err);
      return self.emit('error', err);
    }
    self.emit('synced');
  });

};

Node.prototype._loadNetwork = function(config) {
  if (config.network === 'testnet') {
    this.network = Networks.get('testnet');
  } else if (config.network === 'regtest') {
    Networks.remove(Networks.testnet);
    Networks.add({
      name: 'regtest',
      alias: 'regtest',
      pubkeyhash: 0x6f,
      privatekey: 0xef,
      scripthash: 0xc4,
      xpubkey: 0x043587cf,
      xprivkey: 0x04358394,
      networkMagic: 0xfabfb5da,
      port: 18444,
      dnsSeeds: [ ]
    });
    this.network = Networks.get('regtest');
  } else {
    this.network = Networks.get('livenet');
  }
  $.checkState(this.network, 'Unrecognized network');
};

Node.prototype._loadDB = function(config) {
  if (config.DB) {
    // Other modules can inherit from our DB and replace it with their own
    DB = config.DB;
  }

  if(!config.db) {
    config.db = {};
  }

  // Store the additional indexes in a new directory
  // based on the network configuration and the datadir
  $.checkArgument(config.datadir, 'Please specify "datadir" in configuration options');
  $.checkState(this.network, 'Network property not defined');
  var regtest = Networks.get('regtest');
  var datadir = config.datadir.replace(/^~/, process.env.HOME);
  if (this.network === Networks.livenet) {
    config.db.path = datadir + '/bitcoindjs.db';
  } else if (this.network === Networks.testnet) {
    config.db.path = datadir + '/testnet3/bitcoindjs.db';
  } else if (this.network === regtest) {
    config.db.path = datadir + '/regtest/bitcoindjs.db';
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
  config.db.network = this.network;

  if (!fs.existsSync(config.db.path)) {
    mkdirp.sync(config.db.path);
  }

  this.db = new DB(config.db);
};

Node.prototype._loadConsensus = function(config) {
  if (!config.consensus) {
    config.consensus = {};
  }

  this.Block = Block;

  var genesisBlock;
  if (config.genesis) {
    genesisBlock = config.genesis;
  } else if (config.network === 'testnet') {
    genesisBlock = genesis.testnet;
  } else {
    genesisBlock = genesis.livenet;
  }

  if (_.isString(genesisBlock)) {
    genesisBlock = this.Block.fromBuffer(new Buffer(genesisBlock, 'hex'));
  }

  // pass genesis to chain
  config.consensus.genesis = genesisBlock;
  this.chain = new Chain(config.consensus);
};

Node.prototype._initializeBitcoind = function() {
  var self = this;

  this.bitcoind.on('ready', function(status) {
    log.info('Bitcoin Daemon Ready');
    // Set the current chain height
    var info = self.bitcoind.getInfo();
    self.bitcoindHeight = info.blocks;
    self.db.initialize();
  });

  this.bitcoind.on('open', function(status) {
    log.info('Bitcoin Core Daemon Status:', status);
  });

  // Notify that there is a new tip
  this.bitcoind.on('tip', function(height) {
    log.info('Bitcoin Core Daemon New Height:', height);
    self.bitcoindHeight = height;
    self._syncBitcoind();
  });

  this.bitcoind.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });

};

Node.prototype._initializeDatabase = function() {
  var self = this;

  // Database
  this.db.on('ready', function() {
    log.info('Bitcoin Database Ready');
    self.chain.initialize();
  });

  this.db.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });
};

Node.prototype._initializeChain = function() {
  var self = this;

  // Chain
  this.chain.on('ready', function() {
    log.info('Bitcoin Chain Ready');
    self._syncBitcoind();    
    self.emit('ready');
  });

  this.chain.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });
};

Node.prototype._initialize = function() {

  var self = this;

  // DB References
  this.db.chain = this.chain;
  this.db.Block = this.Block;
  this.db.bitcoind = this.bitcoind;

  // Chain References
  this.chain.db = this.db;

  // Setup Chain of Events
  this._initializeBitcoind();
  this._initializeDatabase();
  this._initializeChain();

};

module.exports = Node;
