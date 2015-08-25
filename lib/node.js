'use strict';

var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore');
var BufferUtil = bitcore.util.buffer;
var Networks = bitcore.Networks;
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;
var Chain = require('./chain');
var DB = require('./db');
var index = require('./');
var log = index.log;
var daemon = require('./daemon');
var Bus = require('./bus');
var BaseModule = require('./module');
var WebService = require('./web');

function Node(config) {
  if(!(this instanceof Node)) {
    return new Node(config);
  }

  this.db = null;
  this.chain = null;
  this.network = null;

  this.modules = {};
  this._unloadedModules = [];

  // TODO type check the arguments of config.modules
  if (config.modules) {
    $.checkArgument(Array.isArray(config.modules));
    this._unloadedModules = config.modules;
  }

  this._loadConfiguration(config);
  this._initialize();
}

util.inherits(Node, EventEmitter);

Node.prototype.openBus = function() {
  return new Bus({db: this.db});
};

Node.prototype.addModule = function(service) {
  var self = this;
  var mod = new service.module({
    node: this
  });

  $.checkState(
    mod instanceof BaseModule,
    'Unexpected module instance type for module:' + service.name
  );

  // include in loaded modules
  this.modules[service.name] = mod;

  // add API methods
  var methodData = mod.getAPIMethods();
  methodData.forEach(function(data) {
    var name = data[0];
    var instance = data[1];
    var method = data[2];

    if (self[name]) {
      throw new Error('Existing API method exists:' + name);
    } else {
      self[name] = function() {
        return method.apply(instance, arguments);
      };
    }
  });
};

Node.prototype.getAllAPIMethods = function() {
  var methods = this.db.getAPIMethods();
  for(var i in this.modules) {
    var mod = this.modules[i];
    methods = methods.concat(mod.getAPIMethods());
  }
  return methods;
};

Node.prototype.getAllPublishEvents = function() {
  var events = this.db.getPublishEvents();
  for (var i in this.modules) {
    var mod = this.modules[i];
    events = events.concat(mod.getPublishEvents());
  }
  return events;
};

Node.prototype._loadConfiguration = function(config) {
  this._loadBitcoinConf(config);
  this._loadBitcoind(config);
  this._loadNetwork(config);
  this._loadDB(config);
  this._loadAPI();
  this._loadConsensus(config);
  this._loadWebService(config);
};

Node.DEFAULT_DAEMON_CONFIG = 'whitelist=127.0.0.1\n' + 'txindex=1\n';

Node.prototype._loadBitcoinConf = function(config) {
  $.checkArgument(config.datadir, 'Please specify "datadir" in configuration options');
  var configPath = config.datadir + '/bitcoin.conf';
  this.bitcoinConfiguration = {};

  if (!fs.existsSync(config.datadir)) {
    mkdirp.sync(config.datadir);
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

  $.checkState((this.bitcoinConfiguration.txindex && this.bitcoinConfiguration.txindex == 1),
  'Txindex option is required in order to use most of the features of bitcore-node. \
Please add "txindex=1" to your configuration and reindex an existing database if necessary with reindex=1');
};

Node.prototype._loadBitcoind = function(config) {
  var bitcoindConfig = {};
  bitcoindConfig.datadir = config.datadir;
  bitcoindConfig.network = config.network;
  bitcoindConfig.node = this;

  // start the bitcoind daemon
  this.bitcoind = daemon(bitcoindConfig);

};

Node.prototype._loadWebService = function(config) {
  var webServiceConfig = {};
  webServiceConfig.port = config.port;
  webServiceConfig.node = this;
  this.webService = new WebService(webServiceConfig);
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

    // TODO: expose prevHash as a string from bitcore
    var ancestorHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

    // We only need to go back until we meet the main chain for the forked block
    // and thus don't need to find the entire chain of hashes.

    while(ancestorHash && !currentHashesMap[ancestorHash]) {
      var blockIndex = self.bitcoind.getBlockIndex(ancestorHash);
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
Node.prototype._syncBitcoindRewind = function(block, done) {

  var self = this;

  self._syncBitcoindAncestor(block, function(err, ancestorHash) {
    if (err) {
      return done(err);
    }
    // Rewind the chain to the common ancestor
    async.whilst(
      function() {
        // Wait until the tip equals the ancestor hash
        return self.chain.tip.hash !== ancestorHash;
      },
      function(removeDone) {

        var tip = self.chain.tip;

        // TODO: expose prevHash as a string from bitcore
        var prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex');

        self.getBlock(prevHash, function(err, previousTip) {
          if (err) {
            removeDone(err);
          }

          // Undo the related indexes for this block
          self.db._onChainRemoveBlock(tip, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
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
  self.chain.lastSavedMetadataThreshold = 30000;

  var height;

  async.whilst(function() {
    height = self.chain.tip.__height;
    return height < self.bitcoind.height && !self.stopping;
  }, function(done) {
    self.bitcoind.getBlock(height + 1, function(err, blockBuffer) {
      if (err) {
        return done(err);
      }

      var block = Block.fromBuffer(blockBuffer);

      // TODO: expose prevHash as a string from bitcore
      var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

      if (prevHash === self.chain.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.chain.tip.__height + 1;

        // Update chain.cache.hashes
        self.chain.cache.hashes[block.hash] = prevHash;

        // Update chain.cache.chainHashes
        self.chain.getHashes(block.hash, function(err, hashes) {
          if (err) {
            return done(err);
          }
          // Create indexes
          self.db._onChainAddBlock(block, function(err) {
            if (err) {
              return done(err);
            }
            self.chain.tip = block;
            log.debug('Saving metadata');
            self.chain.saveMetadata();
            log.debug('Chain added block to main chain');
            self.chain.emit('addblock', block);
            setImmediate(done);
          });
        });

      } else {
        // This block doesn't progress the current tip, so we'll attempt
        // to rewind the chain to the common ancestor of the block and
        // then we can resume syncing.
        self._syncBitcoindRewind(block, done);

      }
    });
  }, function(err) {
    if (err) {
      Error.captureStackTrace(err);
      return self.emit('error', err);
    }

    if(self.stopping) {
      return;
    }

    self.bitcoindSyncing = false;
    self.chain.lastSavedMetadataThreshold = 0;
    self.chain.saveMetadata();

    // If bitcoind is completely synced
    if (self.bitcoind.isSynced()) {
      self.emit('synced');
    }

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
  var options = _.clone(config.db || {});

  if (config.DB) {
    // Other modules can inherit from our DB and replace it with their own
    DB = config.DB;
  }

  // Store the additional indexes in a new directory
  // based on the network configuration and the datadir
  $.checkArgument(config.datadir, 'Please specify "datadir" in configuration options');
  $.checkState(this.network, 'Network property not defined');
  var regtest = Networks.get('regtest');
  if (this.network === Networks.livenet) {
    options.path = config.datadir + '/bitcore-node.db';
  } else if (this.network === Networks.testnet) {
    options.path = config.datadir + '/testnet3/bitcore-node.db';
  } else if (this.network === regtest) {
    options.path = config.datadir + '/regtest/bitcore-node.db';
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
  options.network = this.network;

  if (!fs.existsSync(options.path)) {
    mkdirp.sync(options.path);
  }

  options.node = this;

  this.db = new DB(options);
};

Node.prototype._loadConsensus = function(config) {
  var options;
  if (!config) {
    options = {};
  } else {
    options = _.clone(config.consensus || {});
  }
  options.node = this;
  this.chain = new Chain(options);
};

Node.prototype._loadAPI = function() {
  var self = this;
  var methodData = self.db.getAPIMethods();
  methodData.forEach(function(data) {
    var name = data[0];
    var instance = data[1];
    var method = data[2];

    self[name] = function() {
      return method.apply(instance, arguments);
    };
  });
};

Node.prototype._initialize = function() {
  var self = this;

  this._initializeBitcoind();
  this._initializeDatabase();
  this._initializeChain();

  this.start(function(err) {
    if(err) {
      return self.emit('error', err);
    }
    self.emit('ready');
  });
};

Node.prototype._initializeBitcoind = function() {
  var self = this;

  // Notify that there is a new tip
  this.bitcoind.on('ready', function() {
    log.info('Bitcoin Daemon Ready');
  });

  // Notify that there is a new tip
  this.bitcoind.on('tip', function(height) {
    if(!self.stopping) {
      var percentage = self.bitcoind.syncPercentage();
      log.info('Bitcoin Core Daemon New Height:', height, 'Percentage:', percentage);
      self._syncBitcoind();
    }
  });

  this.bitcoind.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });

};

Node.prototype._initializeDatabase = function() {
  var self = this;
  this.db.on('ready', function() {
    log.info('Bitcoin Database Ready');
  });

  this.db.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });
};

Node.prototype._initializeChain = function() {
  var self = this;
  this.chain.on('ready', function() {
    log.info('Bitcoin Chain Ready');
    self._syncBitcoind();
  });
  this.chain.on('error', function(err) {
    Error.captureStackTrace(err);
    self.emit('error', err);
  });
};

Node.prototype.getServices = function() {
  var services = [
    {
      name: 'bitcoind',
      dependencies: []
    },
    {
      name: 'db',
      dependencies: ['bitcoind'],
    },
    {
      name: 'chain',
      dependencies: ['db']
    }
  ];

  services = services.concat(this._unloadedModules);

  return services;
};

Node.prototype.getServiceOrder = function() {

  var services = this.getServices();

  // organize data for sorting
  var names = [];
  var servicesByName = {};
  for (var i = 0; i < services.length; i++) {
    var service = services[i];
    names.push(service.name);
    servicesByName[service.name] = service;
  }

  var stackNames = {};
  var stack = [];

  function addToStack(names) {
    for(var i = 0; i < names.length; i++) {

      var name = names[i];
      var service = servicesByName[name];

      // first add the dependencies
      addToStack(service.dependencies);

      // add to the stack if it hasn't been added
      if(!stackNames[name]) {
        stack.push(service);
        stackNames[name] = true;
      }

    }
  }

  addToStack(names);

  return stack;
};

Node.prototype.start = function(callback) {
  var self = this;
  var servicesOrder = this.getServiceOrder();

  async.eachSeries(
    servicesOrder,
    function(service, next) {
      log.info('Starting ' + service.name);

      if (service.module) {
        self.addModule(service);
        self.modules[service.name].start(next);
      } else {
        // TODO: implement bitcoind, chain and db as modules
        self[service.name].start(next);
      }
    },
    callback
  );
};

Node.prototype.stop = function(callback) {
  log.info('Beginning shutdown');
  var self = this;
  var services = this.getServiceOrder().reverse();

  this.stopping = true;
  this.emit('stopping');

  async.eachSeries(
    services,
    function(service, next) {
      log.info('Stopping ' + service.name);

      if (service.module) {
        self.modules[service.name].stop(next);
      } else {
        self[service.name].stop(next);
      }
    },
    callback
  );
};

module.exports = Node;
