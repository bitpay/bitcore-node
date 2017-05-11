'use strict';

var util = require('util');
var bitcore = require('bitcore-lib');
var Transaction = bitcore.Transaction;
var zmq = require('zmq');
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var _  = bitcore.deps._;

var index = require('../../');
var errors = index.errors;
var log = index.log;
var Service = require('../../service');
var LRU = require('lru-cache');


function Bitcoin(options) {
  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  Service.call(this, options);
  this.options = options;

  this.subscriptions = {};
  this.subscriptions.rawtransaction = [];
  this.subscriptions.hashblock = [];

  this.startRetryTimes = this.options.startRetryTimes || 120;
  this.startRetryInterval = this.options.startRetryInterval || 1000;

  this._initClients();

  this._process = options.process || process;

  this.on('error', function(err) {
    log.error(err.stack);
  });

  this._hashBlockCache = LRU(100);
}

util.inherits(Bitcoin, Service);

Bitcoin.dependencies = [];

Bitcoin.prototype._initClients = function() {
  var self = this;
  this.nodes = [];
  this.nodesIndex = 0;
  Object.defineProperty(this, 'client', {
    get: function() {
      var client = self.nodes[self.nodesIndex].client;
      self.nodesIndex = (self.nodesIndex + 1) % self.nodes.length;
      return client;
    },
    enumerable: true,
    configurable: false
  });
};

Bitcoin.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1]
  ];
  return methods;
};

Bitcoin.prototype.getPublishEvents = function() {
  return [
    {
      name: 'bitcoind/rawtransaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'rawtransaction'),
      unsubscribe: this.unsubscribe.bind(this, 'rawtransaction')
    },
    {
      name: 'bitcoind/hashblock',
      scope: this,
      subscribe: this.subscribe.bind(this, 'hashblock'),
      unsubscribe: this.unsubscribe.bind(this, 'hashblock')
    }
  ];
};

Bitcoin.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'bitcoind/' + name, 'total:', this.subscriptions[name].length);
};

Bitcoin.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
  log.info(emitter.remoteAddress, 'unsubscribe:', 'bitcoind/' + name, 'total:', this.subscriptions[name].length);
};

Bitcoin.prototype._tryAllClients = function(func, callback) {
  var self = this;
  var nodesIndex = this.nodesIndex;
  var retry = function(done) {
    var client = self.nodes[nodesIndex].client;
    nodesIndex = (nodesIndex + 1) % self.nodes.length;
    func(client, done);
  };
  async.retry({times: this.nodes.length, interval: this.tryAllInterval || 1000}, retry, callback);
};

Bitcoin.prototype._wrapRPCError = function(errObj) {
  var err = new errors.RPCError(errObj.message);
  err.code = errObj.code;
  return err;
};

Bitcoin.prototype._getGenesisBlock = function(callback) {

  var self = this;

  self.client.getBlockHash(0, function(err, response) {

    if (err) {
      return callback(self._wrapRPCError(err));
    }

    var blockhash = response.result;

    self.getRawBlock(blockhash, function(err, blockBuffer) {

      if (err) {
        return callback(err);
      }

      self.genesisBuffer = blockBuffer;
      callback();

    });

  });

};

Bitcoin.prototype._getNetworkTip = function(callback) {

  var self = this;

  self.client.getBestBlockHash(function(err, response) {

    if (err) {
      return callback(self._wrapRPCError(err));
    }

    self.tiphash = response.result;

    self.client.getBlock(response.result, function(err, response) {

      if (err) {
        return callback(self._wrapRPCError(err));
      }

      self.height = response.result.height;
      callback();

    });

  });

};

Bitcoin.prototype._initChain = function(callback) {

  var self = this;

  async.series([

    self._getNetworkTip.bind(self),
    self._getGenesisBlock.bind(self),

  ], function(err) {

    if(err) {
      return callback(err);
    }

    self.emit('ready');
    callback();

  });

};

Bitcoin.prototype._zmqBlockHandler = function(message) {

  var self = this;

  var hashBlockHex = message.toString('hex');

  if (!self._isSendableHashBlock(hashBlockHex)) {
    return;
  }

  self._hashBlockCache.set(hashBlockHex);

  self.tiphash = hashBlockHex;
  self.height++;

  self.emit('block', message);

  for (var i = 0; i < this.subscriptions.hashblock.length; i++) {
    this.subscriptions.hashblock[i].emit('bitcoind/hashblock', hashBlockHex);
  }

};

Bitcoin.prototype._isSendableHashBlock = function(hashBlockHex) {
  return hashBlockHex.length === 64 && !this._hashBlockCache.get(hashBlockHex);
};

Bitcoin.prototype._zmqTransactionHandler = function(node, message) {
  var self = this;
  self.emit('tx', message);
  for (var i = 0; i < this.subscriptions.rawtransaction.length; i++) {
    this.subscriptions.rawtransaction[i].emit('bitcoind/rawtransaction', message.toString('hex'));
  }
};

Bitcoin.prototype._subscribeZmqEvents = function(node) {
  var self = this;
  node.zmqSubSocket.subscribe('hashblock');
  node.zmqSubSocket.subscribe('rawtx');
  node.zmqSubSocket.on('message', function(topic, message) {
    var topicString = topic.toString('utf8');
    if (topicString === 'rawtx') {
      self._zmqTransactionHandler(node, message);
    } else if (topicString === 'hashblock') {
      self._zmqBlockHandler(message);
    }
  });
};

Bitcoin.prototype._initZmqSubSocket = function(node, zmqUrl) {
  node.zmqSubSocket = zmq.socket('sub');

  node.zmqSubSocket.on('connect', function(fd, endPoint) {
    log.info('ZMQ connected to:', endPoint);
  });

  node.zmqSubSocket.on('connect_delay', function(fd, endPoint) {
    if (this.zmqDelayWarningMultiplierCouunt++ >= this.zmqDelayWarningMultiplier) {
      log.warn('ZMQ connection delay:', endPoint);
      this.zmqDelayWarningMultiplierCouunt = 0;
    }
  });

  node.zmqSubSocket.on('disconnect', function(fd, endPoint) {
    log.warn('ZMQ disconnect:', endPoint);
  });

  node.zmqSubSocket.on('monitor_error', function(err) {
    log.error('Error in monitoring: %s, will restart monitoring in 5 seconds', err);
    setTimeout(function() {
      node.zmqSubSocket.monitor(500, 0);
    }, 5000);
  });

  node.zmqSubSocket.monitor(100, 0);
  if (_.isString(zmqUrl)) {
    node.zmqSubSocket.connect(zmqUrl);
  }
};

Bitcoin.prototype._connectProcess = function(config) {
  var self = this;
  var node = {};

  node.client = new BitcoinRPC({
    protocol: config.rpcprotocol || 'http',
    host: config.rpchost || '127.0.0.1',
    port: config.rpcport,
    user: config.rpcuser,
    pass: config.rpcpassword,
    rejectUnauthorized: _.isUndefined(config.rpcstrict) ? true : config.rpcstrict
  });

  self._initZmqSubSocket(node, config.zmqpubrawtx);
  self._subscribeZmqEvents(node);

  return node;
};

Bitcoin.prototype.start = function(callback) {

  var self = this;

  if (!self.options.connect) {
    throw new Error('A "connect" array is required in the bitcoind service configuration.');
  }

  self.nodes = self.options.connect.map(self._connectProcess.bind(self));

  if (self.nodes.length === 0) {
    throw new Error('Could not connect to any servers in connect array.');
  }

  self._initChain(function() {

    log.info('Bitcoin Daemon Ready');
    callback();

  });

};

Bitcoin.prototype.stop = function(callback) {
  callback();
};

Bitcoin.prototype._maybeGetBlockHash = function(blockArg, callback) {
  var self = this;
  if (_.isNumber(blockArg) || (blockArg.length < 40 && /^[0-9]+$/.test(blockArg))) {
    self._tryAllClients(function(client, done) {
      client.getBlockHash(blockArg, function(err, response) {
        if (err) {
          return done(self._wrapRPCError(err));
        }
        done(null, response.result);
      });
    }, callback);
  } else {
    callback(null, blockArg);
  }
};


Bitcoin.prototype.getRawBlock = function(blockArg, callback) {
  var self = this;

  function queryBlock(err, blockhash) {
    if (err) {
      return callback(err);
    }
    self._tryAllClients(function(client, done) {
      self.client.getBlock(blockhash, false, function(err, response) {
        if (err) {
          return done(self._wrapRPCError(err));
        }
        var buffer = new Buffer(response.result, 'hex');
        done(null, buffer);
      });
    }, callback);
  }

  self._maybeGetBlockHash(blockArg, queryBlock);
};

Bitcoin.prototype.getBlockHeader = function(blockArg, callback) {
  var self = this;

  function queryHeader(err, blockhash) {
    if (err) {
      return callback(err);
    }
    self._tryAllClients(function(client, done) {
      client.getBlockHeader(blockhash, function(err, response) {
        if (err) {
          return done(self._wrapRPCError(err));
        }
        var result = response.result;
        var header = {
          hash: result.hash,
          version: result.version,
          confirmations: result.confirmations,
          height: result.height,
          chainWork: result.chainwork,
          prevHash: result.previousblockhash,
          nextHash: result.nextblockhash,
          merkleRoot: result.merkleroot,
          time: result.time,
          medianTime: result.mediantime,
          nonce: result.nonce,
          bits: result.bits,
          difficulty: result.difficulty
        };
        done(null, header);
      });
    }, callback);
  }

  self._maybeGetBlockHash(blockArg, queryHeader);
};

Bitcoin.prototype.getTransaction = function(txid, callback) {
  var self = this;
  self._tryAllClients(function(client, done) {
    //this won't work without a bitcoin node that has a tx index
    self.client.getRawTransaction(txid.toString('hex'), 0, function(err, response) {
      if (err) {
        return done(self._wrapRPCError(err));
      }
      var tx = new Transaction(response.result);
      done(null, tx);
    });
  }, callback);
};

Bitcoin.prototype.getBlock = function(blockArg, callback) {
  var self = this;

  function queryBlock(err, blockhash) {
    if (err) {
      return callback(err);
    }
    self._tryAllClients(function(client, done) {
      client.getBlock(blockhash, false, function(err, response) {
        if (err) {
          return done(self._wrapRPCError(err));
        }
        var blockObj = bitcore.Block.fromString(response.result);
        done(null, blockObj);
      });
    }, callback);
  }

  self._maybeGetBlockHash(blockArg, queryBlock);
};

Bitcoin.prototype.isSynced = function(callback) {
  this.syncPercentage(function(err, percentage) {
    if (err) {
      return callback(err);
    }
    if (Math.round(percentage) >= 100) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });
};

Bitcoin.prototype.syncPercentage = function(callback) {
  var self = this;
  self.client.getBlockchainInfo(function(err, response) {
    if (err) {
      return callback(self._wrapRPCError(err));
    }
    var percentSynced = response.result.verificationprogress * 100;
    callback(null, percentSynced);
  });
};

module.exports = Bitcoin;
