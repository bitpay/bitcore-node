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
    // spread operator '...', fancy way of converting an array arg to discrete args
    return Math.max(...this._peerHeights);
  }

};

P2P.prototype._setFilterScalar = function(peer, scalar) {

  if (!this._filters[peer]) {
    return;
  }

  this._filters[peer] = scalar;

};

P2P.prototype._setupListeners = function() {

  var self = this;

  self._pool.on('peerready', function(peer, addr) {

    log.info('Connected to peer: ' + addr.ip.v4 + ', network: ' +
    peer.network.alias + ', version: ' + peer.version + ', subversion: ' +
    peer.subversion + ', status: ' + peer.status + ', port: ' +
    peer.port + ', best height: ' + peer.bestHeight);

    self._addPeer(peer);
    var bestHeight = self._getBestHeight(peer);

    if (bestHeight >= 0) {
      self.emit('bestHeight', bestHeight);
    }
  });

  self._pool.on('peerdisconnect', function(peer, addr) {

    self._removePeer(peer);
    log.info('Disconnected from peer: ' + addr.ip.v4);

  });

  self._pool.on('peerinv', function(peer, message) {

    var newDataNeeded = [];

    // The bitcoin p2p network can send unsolicited inventory messages for
    // entities such as transactions and blocks. This behavior is configurable
    // via the 'relay' field in the version message that we send when making
    // outbound connections. The relay option is important to keep enabled so
    // that we can reduce the chatter on the network, overall.
    // The problem is that when we do ask for inventory synchronuously,
    // such as when our indexes are syncing or catching up, we can't tell the
    // the difference between unsolicited new messages and actual responses.
    // There does not seem to be identifying information to link requests and
    // responses.

    // What we will do is set a filter scalar on the peer being queried. We
    // will have to assume that the next message from that peer will be our
    // response. The length of the inventory vector will then become our filter
    // scalar. As we respond to the inbound inventory (getdata), we will decrement
    // this filter scalar. This is how we will match request anf response.
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

  });

  self._pool.on('peertx', self._filterTx.bind(self));

  self._pool.on('peerblock', self._broadcastBlock.bind(self));

  self.node.on('ready', function() {
    self._pool.connect();
  });

};

P2P.prototype._filterTx = function(peer, message) {
  var self = this;

  // if this tx matches any of this peer's filters, then emit the tx internally only
  // and not to the external bus
  var filterExists = self._filters[peer];

  if (!filterExists) {
    self._broadcastTx(peer, message);
    return;
  }

  self.emit('tx', message.transaction);

  if (--self._filters[peer] === 0) {
    self._filters[peer] = false;
    self.emit('end');
  }

};

P2P.prototype._broadcastTx = function(peer, message) {
  for (var i = 0; i < this.subscriptions.transaction.length; i++) {
    this.subscriptions.transaction[i].emit('p2p/transaction', message.transaction);
  }
};

P2P.prototype._broadcastBlock = function(peer, message) {
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('p2p/block', message.block);
  }
};

P2P.prototype.getAPIMethods = function() {
  var methods = [
    ['createHeaderStream', this, this.getHeaders, 2],
    ['getMempool', this, this.getMempool, 1],
    ['getBlocks', this, this.getBlocks, 2]
  ];
  return methods;
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
    }
  ];
};


P2P.prototype.createHeaderStream = function(startBlockHash, endBlockHash) {

  var self = this;
  if (!endBlockHash) {
    endBlockHash = startBlockHash;
  }

  var message = self.messages.GetHeaders(startBlockHash, endBlockHash);
  var peer = self._getPeer();

  peer.on('peerheaders', function(peer, message) {
    self.emit('headers', message.headers);
  });

  peer.sendMessage(message);
  return self;

};

P2P.prototype.getMempool = function(callback) {

  var self = this;
  var peer = self._getPeer();

  if (!peer) {
    return callback(new Error('Could not get a peer to retrieve mempool.'));
  }

  self._filters[peer] = true;

  peer.sendMessage(self.messages.MemPool());
  var mempool = [];

  self.on('tx', function(tx) {
    mempool.push(tx);
  });

  self.on('end', function() {
    callback(null, mempool);
  });
};

P2P.prototype.getBlocks = function(startBlockHash, endBlockHash) {

  var self = this;
  if (!endBlockHash) {
    endBlockHash = startBlockHash;
  }

  var peer = self._getPeer();

  if (!peer) {
    return callback(new Error('Could not get a peer to retrieve blocks.'));
  }

  self._filters[peer] = true;

  var message = this.messages.GetBlocks({ starts: [startBlockHash] });
  peer.sendMessage(message);
  var blocks = [];

  self.on('block', function(block) {
    blocks.push(block);
  });

  self.on('end', function() {
    callback(null, blocks);
  });

};

module.exports = P2P;
