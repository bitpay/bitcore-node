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

/*
  Purpose:
      1. join a P2P
      2. relay messages
      3. publish new transactions (pub/sub)
      4. publish new blocks (pub/sub)
      5. broadcast messages on behalf of subscribers (block headers, blocks, bloom filters)
*/
var P2P = function(options) {
  if (!(this instanceof P2P)) {
    return new P2P(options);
  }
  Service.call(this, options);
  this.options = options;
  this._maxPeers = this.options.maxPeers || 60;
  this._peers = this.options.peers;
  this.subscriptions = {};
};

util.inherits(P2P, Service);

P2P.dependencies = [];

P2P.prototype.start = function(callback) {
  var self = this;
  self.once('synced', function() {
    self._initPool();
    self._initCache();
    self._pool.connect();
    self._synced = true;
  });
  callback();
};

P2P.prototype.stop = function(callback) {
  var self = this;
  setImmediate(function() {
    self._pool.disconnect();
    callback();
  });
};

P2P.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'p2p/' + name, 'total:', this.subscriptions[name].length);
};

P2P.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
  log.info(emitter.remoteAddress, 'unsubscribe:', 'p2p/' + name, 'total:', this.subscriptions[name].length);
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
  return [
    {
      name: 'p2p/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'p2p/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    },
    {
      name: 'bitcoind/rawblock',
      scope: this,
      subscribe: this.subscribe.bind(this, 'rawblock'),
      unsubscribe: this.unsubscribe.bind(this, 'rawblock')
    }
  ];
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
