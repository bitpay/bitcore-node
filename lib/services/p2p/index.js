'use strict';

var p2p = require('bitcore-p2p');
var LRU = require('lru-cache');
var util = require('util');
var _ = require('lodash');
var bitcore = require('bitcore-lib');
var index = require('../../');
var log = index.log;
var BaseService = require('../../service');
var constants = require('../../constants');

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

  BaseService.call(this, options);
  this.options = options;
  this._maxPeers = this.options.maxPeers || 60;
  this._minPeers = this.options.minPeers || 1;
  this._configPeers = this.options.peers;
  this.subscriptions = {};
  this.subscriptions.block = [];
  this.subscriptions.transaction = [];
  this.messages = new p2p.Messages({ network: this.node.network });
  this._peerHeights = [];
  this._peers = [];
  this._peerIndex = 0;
  this._filters = {};
};

util.inherits(P2P, BaseService);

P2P.dependencies = [];

P2P.prototype.start = function(callback) {

  var self = this;
  self._initCache();
  self._initPool();
  this._setupListeners();
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
      name: 'p2p/mempool',
      scope: this,
      subscribe: this.subscribe.bind(this, 'mempool'),
      unsubscribe: this.unsubscribe.bind(this, 'mempool')
    },
    {
      name: 'p2p/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    },
    {
      name: 'p2p/historicalBlock',
      scope: this,
      subscribe: this.subscribe.bind(this, 'historicalBlock'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    },
    {
      name: 'p2p/header',
      scope: this,
      subscribe: this.subscribe.bind(this, 'header'),
      unsubscribe: this.unsubscribe.bind(this, 'header')
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
    opts.dnsSeed = false;
  }
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

  self._addPeer(peer);
  var bestHeight = self._getBestHeight(peer);

  if (bestHeight >= 0) {
    self.emit('bestHeight', bestHeight);
  }

};

P2P.prototype._onPeerDisconnect = function(peer, addr) {

  self._removePeer(peer);
  log.info('Disconnected from peer: ' + addr.ip.v4);

};

P2P.prototype._onPeerInventory = function(peer, message) {

  var newDataNeeded = [];

  self._setFilterScalar(peer, message.inventory.length);

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
};

p2p.prototype._onPeerBlock = function(peer, message) {
};

P2P.prototype._setupListeners = function() {

  var self = this;
  self._pool.on('peerready', self._onPeerReady.bind(self));
  self._pool.on('peerdisconnect', self._onPeerDisconnect.bind(self));
  self._pool.on('peerinv', self._onPeerInventory.bind(self));
  self._pool.on('peertx', self._onPeerTx.bind(self));
  self._pool.on('peerblock', self._onPeerBlock.bind(self));
  self.node.on('ready', function() {
    self._pool.connect();
  });

};

P2P.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

P2P.prototype.getAPIMethods = function() {
  var methods = [
    ['getHeaders', this, this.getHeaders, 2],
    ['getMempool', this, this.getMempool, 1],
    ['getBlocks', this, this.getBlocks, 2]
  ];
  return methods;
};

P2P.prototype._getResourceFilter = function(filter, resource) {

  // this function knows about mempool, block and header filters
  // mempool filters are considered after the tx is delivered to us
  // because we can't match a tx to the query params.
  if (resource === 'mempool') {
    if (resource instanceof LRU) {
      return filter;
    }

  }

};

P2P.prototype._getResourceMessage = function(filter, resource) {

  // filter should be a list of block hashes representing the
  // resource that are -not- needed, all headers outside this list will be
  // broadcast on the p2p/headers bus, meaning all subscribers to
  // this event will get the results whether they asked for them
  // or not.

  // _getPeer can throw
  var peer = this._getPeer();

  return this._getResourceFilter(filter, resource);

};

P2P.prototype.getHeaders = function(filter) {

  var headerFilter = this._getResourceMessage(filter, 'headers');
  peer.sendMessage(this.messages.GetHeader(headerFilter));

};

P2P.prototype.getMempool = function(filter) {

  // mempools can grow quite large, especially if subscribers are liberally accepting
  // all manner of txs (low/no fee, "non-standard", etc.). As such, this filter can
  // grow quite large over time. Care should be taken to limit the size of this filter.
  // Even still, when a tx is broadcasted, the reference to it is dropped from the filter.
  this._mempoolFilter = this._getResourceMessage(filter, 'mempool');

  peer.sendMessage(self.messages.MemPool());

};

P2P.prototype.getBlocks = function(filter) {

  // it is on the caller to work out what block hashes are needed from the network,
  // so a list of block hashes should be given. If this is an initial sync from the
  // genesis block, then this list will be quite large (32 bytes * current block height).
  var blockFilter = this._getResourceMessage(filter, 'blocks');
  peer.sendMessage(this.messages.GetBlock(blockFilter));

};

module.exports = P2P;
