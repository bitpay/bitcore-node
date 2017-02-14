'use strict';

var p2p = require('bitcore-p2p');
var messages = new p2p.Messages();
var LRU = require('lru-cache');
var util = require('util');
var _ = require('lodash');
var bitcore = require('bitcore-lib');
var index = require('../');
var log = index.log;
var Service = require('../../service');

var P2P = function(options) {
  if (!(this instanceof P2P)) {
    return new P2P(options);
  }

  Service.call(this, options);
  this.options = options;
  this._maxPeers = this.options.maxPeers || 60;
  this._peers = this.options.peers;
  this._maxMempoolSize = this.options.maxMempoolSize || 100 * 1024 * 1024;
  this._synced = false;
  this.initialHeight = 0;
};

util.inherits(P2P, Service);

P2P.dependencies = [ 'bitcoind', 'db' ];

P2P.prototype.start = function(callback) {
  //Step 1: connect to peer(s) as per config
  //Step 2: memoize the tip
  //Step 3: wait for other services to register listeners
  var self = this;
  self.once('synced', function() {
    self._initPrefix(callback);
    self._initPool();
    self._initCache();
    self._pool.connect();
    self._synced = true;
  });
};

P2P.prototype.stop = function(callback) {
  var self = this;
  setImmediate(function() {
    self._pool.disconnect();
    callback();
  });
};

P2P.prototype._initPrefix = function(callback) {
  var self = this;
  self.node.services.db.getPrefix(self.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;
    callback();
  });
};

P2P.prototype._initCache = function() {
  this._inv = LRU(2000);
  this._cache = LRU({
    max: this._maxMempoolSize,
    length: function(tx) { return tx.toBuffer().length; }
  });
};

P2P.prototype._initPool = function() {
  var opts = {};
  var _addrs = [];
  if (this.addrs && _.isArray(this.addrs)) {
    for(var i = 0; i < this.addrs.length; i++) {
      _addrs.push({
        ip: {
          v4: this.addrs[i]
        }
      });
    }
    opts.addrs = _addrs;
    opts.dnsSeed = false;
  }
  opts.maxPeers = this._maxPeers;
  opts.network = this.node.getNetworkName();
  this._pool = new p2p.Pool(opts);
  this._setupListeners();
};

P2P.prototype.validTx = function(tx) {
  return tx;
};

P2P.prototype._setupListeners = function() {
  var self = this;

  self._pool.on('peerready', function(peer, addr) {
    log.info('Connected to peer: ' + addr.ip.v4);
    peer.sendMessage(messages.MemPool());
  });

  self._pool.on('peerdisconnect', function(peer, addr) {
    log.info('Disconnected from peer: ' + addr.ip.v4);
  });

  self._pool.on('peerinv', function(peer, message) {
    var invList = [];
    message.inventory.forEach(function(inv) {
      var hash = self._inv.get(inv.hash);
      if (inv.type === 1 && !hash) {
        self._inv.set(inv.hash, true);
        invList.push(inv);
      }
    });
    peer.sendMessage(messages.GetData(invList));
  });

  self._pool.on('peertx', function(peer, message) {
    var tx = new bitcore.Transaction(message.transaction);
    if (self.validTx(tx)) {
      return self._cache.set(tx.id, tx);
    }
    return self._operations.push({
      type: 'put',
      key: new Buffer(tx.id),
      value: tx.toBuffer()
    });
  });
};

P2P.prototype.getAPIMethods = function() {
  return [];
};

P2P.prototype.getPublishEvents = function() {
  return [];
};

P2P.prototype.blockHandler = function(block, connected, callback) {
  var self = this;

  var operations = [];

  if (!self._synced) {
    return callback(operations);
  }

  var action = 'put';
  var reverseAction = 'del';
  if (!connected) {
    action = 'del';
    reverseAction = 'put';
  }

  block.transactions.forEach(function(tx) {
    self._cache.del(tx.id);
  });
};

module.exports = P2P;
