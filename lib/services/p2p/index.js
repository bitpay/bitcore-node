'use strict';

var p2p = require('bitcore-p2p');
var LRU = require('lru-cache');
var util = require('util');
var index = require('../../');
var log = index.log;
var BaseService = require('../../service');
var assert = require('assert');
var Bcoin = require('./bcoin');
var BcoinTx = require('bcoin').tx;
var BitcoreRPC = require('bitcoind-rpc');
var Networks = require('bitcore-lib').Networks;
var LRU = require('lru-cache');

var P2P = function(options) {

  if (!(this instanceof P2P)) {
    return new P2P(options);
  }

  BaseService.call(this, options);
  this._options = options;

  this._initRPC(options);
  this._initP2P();
  this._initPubSub();
  this._bcoin = null;
  this._currentBestHeight = null;
  this._latestBits = 0x1d00ffff;
  this._outgoingTxs = LRU(100); // these are outgoing txs that are awaiting getdata messages
  this._blockCache = options.blockCacheCount || LRU({
    max: 10,
    maxAge: 1000 * 60 * 5}); // keep this modest to avoid memory dumps [hash -> block]

};

util.inherits(P2P, BaseService);

P2P.dependencies = [];

P2P.prototype.clearInventoryCache = function() {
  this._inv.reset();
};

P2P.prototype.getAPIMethods = function() {
  var methods = [
    ['clearInventoryCache', this, this.clearInventoryCache, 0],
    ['getP2PBlock', this, this.getP2PBlock, 1],
    ['getHeaders', this, this.getHeaders, 1],
    ['getMempool', this, this.getMempool, 0],
    ['sendTransaction', this, this.sendTransaction, 1]
  ];
  return methods;
};

P2P.prototype.getNumberOfPeers = function() {
  return this._pool.numberConnected;
};

P2P.prototype.getP2PBlock = function(opts, callback) {

  // opts is { filter: {<start and end hashes>}, blockHash: block hash we want }

  var self = this;

  // do we already have this block in our cache?
  var block = self._blockCache.get(opts.blockHash);

  if (block) {
    return callback(block);
  }

  var peer = self._getPeer();

  var blockFilter = self._setResourceFilter(opts.filter, 'blocks');

  // there is a possibility that the main chain has reorganized after we last
  // computed our expected block and before our peer computes what block to
  // send us in response.
  // In self case, we want to abandon self block and remove its listener.
  // Our caller should also reset its expectations and re-compute its expected
  // block and call us again.
  // If we are wrong about the reorg, then the peer is just really slow and we ought
  // to use self peer anyway.
  setTimeout(function() {
    self.removeListener(opts.blockHash, callback);
  }, 5000);

  self.once(opts.blockHash, callback);

  peer.sendMessage(self.messages.GetBlocks(blockFilter));
};

P2P.prototype.getHeaders = function(filter) {

  var peer = this._getPeer();
  var headerFilter = this._setResourceFilter(filter, 'headers');
  peer.sendMessage(this.messages.GetHeaders(headerFilter));

};

P2P.prototype.getMempool = function() {
  var peer = this._getPeer();
  peer.sendMessage(this.messages.MemPool());
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


P2P.prototype.sendTransaction = function(tx, callback) {
  return this._client.sendRawTransaction(tx, callback);
};


P2P.prototype.start = function(callback) {
  var self = this;
  self._startBcoinIfNecessary(function(){
    self._initCache();
    self._initPool();
    self._setListeners();
    callback();
  });
};

P2P.prototype._disconnectPool = function() {

  log.info('P2P Service: disconnecting pool and peers. SIGINT issued, system shutdown initiated');
  this._pool.disconnect();

};

P2P.prototype.stop = function(callback) {

  if (this._bcoin){
    return this._bcoin.stop(callback);
  }

  setImmediate(callback);
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


// --- privates

P2P.prototype._addPeer = function(peer) {
  this._peers.push(peer);
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

P2P.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

P2P.prototype._setRetryInterval = function() {
  var self = this;
  if (!self._retryInterval && !self.node.stopping) {

    self._retryInterval = setInterval(function() {
      log.info('Retrying connection to p2p network.');
      self._pool.connect();
    }, 5000);

  }
};

P2P.prototype._connect = function() {

  var self = this;

  log.info('Connecting to p2p network.');
  self._pool.connect();

  self._setRetryInterval();

};

P2P.prototype._getBestHeight = function() {

  if (this._peers === 0) {
    return 0;
  }

  var maxHeight = -1;
  for(var i = 0; i < this._peers.length; i++) {
    if (this._peers[i].bestHeight > maxHeight) {
      maxHeight = this._peers[i].bestHeight;
      this._peer = this._peers[i];
    }
  }
  return maxHeight;
};

// we should only choose from a list of peers that sync'ed
P2P.prototype._getPeer = function() {
  return this._peer;
};

P2P.prototype._hasPeers = function() {
  return this._options &&
    this._options.peers &&
    this._options.peers.length > 0;
};

P2P.prototype._initCache = function() {
  this._inv = LRU(1000);
};

P2P.prototype._initRPC = function (options) {
this._config = options.rpc || {
    user: 'bitcoin',
    pass: 'local321',
    host: 'localhost',
    protocol: 'http',
    port: 8332
  };
  this._client = new BitcoreRPC(this._config);
}

P2P.prototype._initP2P = function() {
  this._maxPeers = this._options.maxPeers || 60;
  this._minPeers = this._options.minPeers || 0;
  this._configPeers = this._options.peers;

  if (this.node.network === 'regtest') {
    Networks.enableRegtest();
  }
  this.messages = new p2p.Messages({ network: Networks.get(this.node.network), Transaction: BcoinTx });
  this._peerHeights = [];
  this._peers = [];
  this._peerIndex = 0;
  this._mempoolFilter = [];
};

P2P.prototype._initPool = function() {
  var opts = {};
  if (this._configPeers) {
    opts.addrs = this._configPeers;
  }
  opts.dnsSeed = false;
  opts.listenAddr = false;
  opts.maxPeers = this._maxPeers;
  opts.network = this.node.network;
  p2p.Pool.RetrySeconds = 3;
  this._pool = new p2p.Pool(opts);
};

P2P.prototype._initPubSub = function() {
  this.subscriptions = {};
  this.subscriptions.block = [];
  this.subscriptions.headers = [];
  this.subscriptions.transaction = [];
};

P2P.prototype._onPeerBlock = function(peer, message) {
  this._blockCache.set(message.block.rhash(), message.block);
  this.emit(message.block.rhash(), message.block);
  this._broadcast(this.subscriptions.block, 'p2p/block', message.block);
};

P2P.prototype._onPeerDisconnect = function(peer, addr) {

  this._removePeer(peer);

  if (this._peers.length < 1) {
    this._setRetryInterval();
  }

  log.info('Disconnected from peer: ' + addr.ip.v4);

};

P2P.prototype._onPeerGetData = function(peer, message) {
  // we can only respond to tx messages
  var txId  = message.inventory[0].hash.reverse().toString('hex');
  var tx = this._outgoingTxs.get(txId);
  if (tx) {
    peer.sendMessage(this.messages.Transaction(tx, { Transaction: BcoinTx }));
  }
};

P2P.prototype._onPeerHeaders = function(peer, message) {
  this._broadcast(this.subscriptions.headers, 'p2p/headers', message.headers);
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

P2P.prototype._matchNetwork = function(network) {

  if (this.node.network !== network.name &&
    this.node.network !== network.alias) {
    log.error('Configured network: "' + this.node.network +
      '" does not match our peer\'s reported network: "' +
      network.name + '".');
    return this.node.stop();
  }

  return this.node.network === network.name ? network.name : network.alias;

};

P2P.prototype._onPeerReady = function(peer, addr) {

  // clear any interval timers that we previously set
  if (this._retryInterval) {
    clearInterval(this._retryInterval);
    this._retryInterval = null;
  }

  // want to make sure the peer we are connecting to matches our network config.
  var network = this._matchNetwork(peer.network);

  if (!network) {
    return;
  }

  log.info('Connected to peer: ' + addr.ip.v4 + ', network: ' +
    network + ', version: ' + peer.version + ', subversion: ' +
      peer.subversion + ', status: ' + peer.status + ', port: ' +
      peer.port + ', best height: ' + peer.bestHeight);

  this._addPeer(peer);
  var bestHeight = this._getBestHeight();

  if (bestHeight >= 0) {
    this.emit('bestHeight', bestHeight);
  }

};


P2P.prototype._onPeerTx = function(peer, message) {
  this._broadcast(this.subscriptions.transaction, 'p2p/transaction', message.transaction);
};

P2P.prototype._removePeer = function(peer) {
  this._peers.splice(this._peers.indexOf(peer), 1);
};

P2P.prototype._setListeners = function() {
  var self = this;
  self.node.on('stopping', self._disconnectPool.bind(self));
  self._pool.on('peerready', self._onPeerReady.bind(self));
  self._pool.on('peerdisconnect', self._onPeerDisconnect.bind(self));
  self._pool.on('peerinv', self._onPeerInventory.bind(self));
  self._pool.on('peertx', self._onPeerTx.bind(self));
  self._pool.on('peerblock', self._onPeerBlock.bind(self));
  self._pool.on('peerheaders', self._onPeerHeaders.bind(self));
  self._pool.on('peergetdata', self._onPeerGetData.bind(self));
  self.node.on('ready', self._connect.bind(self));
};

P2P.prototype._setResourceFilter = function(filter) {

  assert(filter && filter.startHash, 'A "startHash" field is required to retrieve headers or blocks');
  if (!filter.endHash) {
    filter.endHash = 0;
  }
  return { starts: [filter.startHash], stop: filter.endHash };

};

P2P.prototype._startBcoin = function(callback) {

  var self = this;

  var network;
  var port;
  if (['livenet', 'live', 'main', 'mainnet'].indexOf(this.node.network) !== -1) {
    network = 'main';
    port = this._configPeers[0].port || 8333;
  } else if (this.node.network !== 'regtest') {
    network = 'testnet';
    port = this._configPeers[0].port || 18333;
  } else {
    network = this.node.network;
    port = this._configPeers[0].port || 48444;
  }

  self._bcoin = new Bcoin({
    network: network,
    prefix: self.node.datadir,
    port: port
  });

  self._bcoin.start(callback);

};

P2P.prototype._startBcoinIfNecessary = function(callback) {
  if (!this._hasPeers()) {
    log.info('Peers not explicitly configured, starting a local bcoin node.');
    this._configPeers = [{ ip: { v4: '127.0.0.1'} }];
    return this._startBcoin(callback);
  }
  setImmediate(callback);
};

module.exports = P2P;
