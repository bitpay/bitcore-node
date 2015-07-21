'use strict';

var async = require('async');
var Chain = require('./chain');
var Block = require('./block');
var DB = require('./db');
var chainlib = require('chainlib');
var P2P = chainlib.P2P;
var fs = require('fs');
var BaseNode = chainlib.Node;
var util = require('util');
var log = chainlib.log;
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var genesis = require('./genesis.json');
var daemon = require('./daemon');

function Node(config) {
  BaseNode.call(this, config);
  this.testnet = config.testnet;
}

util.inherits(Node, BaseNode);

Node.prototype._loadConfiguration = function(config) {
  var self = this;
  this._loadBitcoinConf(config);
  this._loadBitcoind(config);
  Node.super_.prototype._loadConfiguration.call(self, config);
};

Node.SYNC_STRATEGIES = {
  P2P: 'p2p',
  BITCOIND: 'bitcoind'
};

Node.prototype.setSyncStrategy = function(strategy) {
  this.syncStrategy = strategy;

  if (this.syncStrategy === Node.SYNC_STRATEGIES.P2P) {
    this.p2p.startSync();
  } else if (this.syncStrategy === Node.SYNC_STRATEGIES.BITCOIND) {
    this.p2p.disableSync = true;
    this._syncBitcoind();
  } else {
    throw new Error('Strategy "' + strategy + '" is unknown.');
  }

};

Node.prototype._loadBitcoinConf = function(config) {
  $.checkArgument(config.datadir, 'Please specify "datadir" in configuration options');
  var datadir = config.datadir.replace(/^~/, process.env.HOME);
  this.bitcoinConfiguration = {};
  var file = fs.readFileSync(datadir + '/bitcoin.conf');
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
  bitcoindConfig.testnet = config.testnet;

  // start the bitcoind daemon
  this.bitcoind = daemon(bitcoindConfig);

};

Node.prototype._syncBitcoind = function() {
  var self = this;

  log.info('Starting Bitcoind Sync');

  var info = self.bitcoind.getInfo();
  var height;

  async.whilst(function() {
    if (self.syncStrategy !== Node.SYNC_STRATEGIES.BITCOIND) {
      log.info('Stopping Bitcoind Sync');
      return false;
    }
    height = self.chain.tip.__height;
    return height < info.blocks;
  }, function(next) {
    self.bitcoind.getBlock(height + 1, function(err, blockBuffer) {
      if (err) {
        return next(err);
      }
      self.chain.addBlock(self.Block.fromBuffer(blockBuffer), next);
    });
  }, function(err) {
    if (err) {
      Error.captureStackTrace(err);
      return self.emit('error', err);
    }
    // we're done resume syncing via p2p to handle forks
    self.p2p.synced = true;
    self.setSyncStrategy(Node.SYNC_STRATEGIES.P2P);
    self.emit('synced');
  });

};

Node.prototype._loadNetwork = function(config) {
  if (config.network) {
    Networks.add(config.network);
    this.network = Networks.get(config.network.name);
  } else if (config.testnet) {
    this.network = Networks.get('testnet');
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
  var datadir = config.datadir.replace(/^~/, process.env.HOME);
  if (this.network === Networks.testnet) {
    config.db.path = datadir + '/testnet3/bitcoindjs.db';
  } else if (this.network === Networks.livenet) {
    config.db.path = datadir + '/bitcoindjs.db';
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
  config.db.network = this.network;

  this.db = new DB(config.db);
};

Node.prototype._loadP2P = function(config) {
  if (!config.p2p) {
    config.p2p = {};
  }
  config.p2p.noListen = true;
  config.p2p.network = this.network;

  // We only want to directly connect via p2p to the trusted bitcoind daemon
  var port = 8333;
  if (this.bitcoinConfiguration && this.bitcoinConfiguration.port) {
    port = this.bitcoinConfiguration.port;
  } else if (this.network === Networks.testnet) {
    port = 18333;
  }
  config.p2p.addrs = [
    {
      ip: {
        v4: '127.0.0.1'
      },
      port: port
    }
  ];
  config.p2p.dnsSeed = false;
  config.p2p.Transaction = this.db.Transaction;
  config.p2p.Block = this.Block;
  config.p2p.disableSync = true; // Disable p2p syncing and instead use bitcoind sync
  this.p2p = new P2P(config.p2p);
};

Node.prototype._loadConsensus = function(config) {
  if (!config.consensus) {
    config.consensus = {};
  }

  this.Block = Block;

  var genesisBlock;
  if (config.genesis) {
    genesisBlock = config.genesis;
  } else if (config.testnet) {
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

  // Bitcoind
  this.bitcoind.on('ready', function(status) {
    log.info('Bitcoin Daemon Ready');
    self.db.initialize();
  });

  this.bitcoind.on('open', function(status) {
    log.info('Bitcoin Core Daemon Status:', status);
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
    self.p2p.initialize();
  });

  this.chain.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });
};

Node.prototype._initializeP2P = function() {
  var self = this;

  // Peer-to-Peer
  this.p2p.on('ready', function() {
    log.info('Bitcoin P2P Ready');
    self.emit('ready');
  });

  this.p2p.on('synced', function() {
    log.info('Bitcoin P2P Synced');
    self.emit('synced');
  });

  this.p2p.on('error', function(err) {
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
  this.chain.p2p = this.p2p;

  // P2P References
  this.p2p.db = this.db;
  this.p2p.chain = this.chain;

  // Setup Chain of Events
  this._initializeBitcoind();
  this._initializeDatabase();
  this._initializeChain();
  this._initializeP2P();

  this.on('ready', function() {
    self.setSyncStrategy(Node.SYNC_STRATEGIES.BITCOIND);
  });

};

module.exports = Node;
