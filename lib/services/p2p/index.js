'use strict';

var p2p = require('bitcore-p2p');
var LRU = require('lru-cache');
var util = require('util');
var index = require('../../');
var log = index.log;
var BaseService = require('../../service');
var assert = require('assert');
var Bcoin = require('./bcoin');

var P2P = function(options) {

  if (!(this instanceof P2P)) {
    return new P2P(options);
  }

  BaseService.call(this, options);
  this._options = options;

  this._startBcoinIfNecessary();
  this._initP2P();
  this._initPubSub();
  this._bcoin;

};

util.inherits(P2P, BaseService);

P2P.dependencies = [];


P2P.prototype._hasPeers = function() {
  return this._options &&
    this._options.peers &&
    this._options.peers.host;
};

P2P.prototype._startBcoin = function() {
  this._bcoin = new Bcoin({
    network: this.node.getNetworkName(),
    prefix: this.node.datadir
  });
  this._bcoin.start();
};

P2P.prototype._initP2P = function() {
  this._maxPeers = this._options.maxPeers || 60;
  this._minPeers = this._options.minPeers || 1;
  this._configPeers = this._options.peers;
  this.messages = new p2p.Messages({ network: this.node.network });
  this._peerHeights = [];
  this._peers = [];
  this._peerIndex = 0;
  this._mempoolFilter = [];
};

P2P.prototype._initPubSub = function() {
  this.subscriptions = {};
  this.subscriptions.block = [];
  this.subscriptions.headers = [];
  this.subscriptions.transaction = [];
};


P2P.prototype._startBcoinIfNecessary = function() {
  if (!this._hasPeers()) {
    log.info('Peers not explicitly configured, starting a local bcoin node.');
    this._startBcoin();
    this._options.peers = [{ ip: { v4: '127.0.0.1' }, port: 48444}];
  }
};

P2P.prototype.start = function(callback) {

  var self = this;
  self._initCache();
  self._initPool();
  this._setListeners();
  callback();

};

P2P.prototype.stop = function(callback) {

  var self = this;
  self._pool.disconnect();
  callback();

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
      name: 'p2p/headers',
      scope: this,
      subscribe: this.subscribe.bind(this, 'headers'),
      unsubscribe: this.unsubscribe.bind(this, 'headers')
    }
  ];
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
  this._cache = [];
};

P2P.prototype._initPool = function() {
  var opts = {};
  if (this._configPeers) {
    opts.addrs = this._configPeers;
  }
  opts.dnsSeed = false;
  opts.maxPeers = this._maxPeers;
  opts.network = this.node.getNetworkName();
  this._pool = new p2p.Pool(opts);
};

P2P.prototype._addPeer = function(peer) {
  this._peers.push(peer);
};

P2P.prototype._removePeer = function(peer) {
  this._peers.splice(this._peers.indexOf(peer), 1);
};

P2P.prototype._getPeer = function() {

  if (this._peers.length === 0) {
    return;
  }
  var index = this._peerIndex++ % this._peers.length;
  return this._peers[index];
};

P2P.prototype._getBestHeight = function(peer) {

  this._peerHeights.push(peer.bestHeight);

  if (this._peerHeights.length >= this._minPeers) {
    return Math.max(...this._peerHeights);
  }

};

P2P.prototype._onPeerReady = function(peer, addr) {

  log.info('Connected to peer: ' + addr.ip.v4 + ', network: ' +
    peer.network.alias + ', version: ' + peer.version + ', subversion: ' +
      peer.subversion + ', status: ' + peer.status + ', port: ' +
      peer.port + ', best height: ' + peer.bestHeight);

  this._addPeer(peer);
  var bestHeight = this._getBestHeight(peer);

  if (bestHeight >= 0) {
    this.emit('bestHeight', bestHeight);
  }

};

P2P.prototype._onPeerDisconnect = function(peer, addr) {

  this._removePeer(peer);
  log.info('Disconnected from peer: ' + addr.ip.v4);

};

P2P.prototype._onPeerInventory = function(peer, message) {

  var self = this;
  var newDataNeeded = [];
  message.inventory.forEach(function(inv) {

    if (!self._inv.get(inv.hash)) {

      self._inv.set(inv.hash, true);

      newDataNeeded.push(inv);

    }

  });

  if (newDataNeeded.length > 0) {
    peer.sendMessage(self.messages.GetData(newDataNeeded));
  }
};

P2P.prototype._onPeerTx = function(peer, message) {
  var filteredMessage = this._applyMempoolFilter(message);
  if (filteredMessage) {
    this._broadcast(this.subscriptions.transaction, 'p2p/transaction', message.transaction);
  }
};

P2P.prototype._onPeerBlock = function(peer, message) {
  this._broadcast(this.subscriptions.block, 'p2p/block', message.block);
};

P2P.prototype._onPeerHeaders = function(peer, message) {
  this._broadcast(this.subscriptions.headers, 'p2p/headers', message.headers);
};

P2P.prototype._setListeners = function() {

  var self = this;
  self._pool.on('peerready', self._onPeerReady.bind(self));
  self._pool.on('peerdisconnect', self._onPeerDisconnect.bind(self));
  self._pool.on('peerinv', self._onPeerInventory.bind(self));
  self._pool.on('peertx', self._onPeerTx.bind(self));
  self._pool.on('peerblock', self._onPeerBlock.bind(self));
  self._pool.on('peerheaders', self._onPeerHeaders.bind(self));
  self.node.once('ready', self._connect.bind(self));
  if (self._bcoin) {
    self._bcoin.emitter.once('connect', self._connect.bind(self));
  }

};

P2P.prototype._connect = function() {
  this._connectCalled = this._connectCalled > 0 ? 2 : 1;
  if (this._connectCalled > 1) {
    log.info('Connecting to p2p network.');
    this._pool.connect();
  }
};

P2P.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

P2P.prototype._applyMempoolFilter = function(message) {
  if (!this._mempoolFilter) {
    return message;
  }
  var txIndex = this._mempoolFilter.indexOf(message.transaction.hash);
  if (txIndex >= 0) {
    this._mempoolFilter.splice(txIndex, 1);
    return;
  }
  return message;
};

P2P.prototype._setResourceFilter = function(filter, resource) {

  // startHash is usually the last block or header you have, endHash is a hash that comes after that hash,
  // or a block at a greater height
  if (resource === 'headers' || resource === 'blocks') {
    assert(filter && filter.startHash, 'A "startHash" field is required to retrieve headers or blocks');
    if (!filter.endHash) {
      filter.endHash = 0;
    }
    return { starts: [filter.startHash], stop: filter.endHash };
  }

  // this function knows about mempool, block and header filters
  // mempool filters are considered after the tx is delivered to us
  // because we can't match a tx to the query params.
  if (resource === 'mempool') {
    this._mempoolFilter = filter;
    return;
  }

};

P2P.prototype.getAPIMethods = function() {
  var methods = [
    ['getHeaders', this, this.getHeaders, 1],
    ['getMempool', this, this.getMempool, 0],
    ['getBlocks', this, this.getBlocks, 1]
  ];
  return methods;
};

P2P.prototype.getHeaders = function(filter) {

  var peer = this._getPeer();
  var headerFilter = this._setResourceFilter(filter, 'headers');
  peer.sendMessage(this.messages.GetHeaders(headerFilter));

};

P2P.prototype.getMempool = function(filter) {

  var peer = this._getPeer();

  // mempools can grow quite large, especially if subscribers are liberally accepting
  // all manner of txs (low/no fee, "non-standard", etc.). As such, this filter can
  // grow quite large over time. Care should be taken to limit the size of this filter.
  // Even still, when a tx is broadcasted, the reference to it is dropped from the filter.
  this._setResourceFilter(filter, 'mempool');

  peer.sendMessage(this.messages.MemPool());

};

P2P.prototype.getBlocks = function(filter) {

  var peer = this._getPeer();
  var blockFilter = this._setResourceFilter(filter, 'blocks');
  peer.sendMessage(this.messages.GetBlocks(blockFilter));

};

P2P.prototype.clearInventoryCache = function() {
  this._inv.reset();
};

module.exports = P2P;
