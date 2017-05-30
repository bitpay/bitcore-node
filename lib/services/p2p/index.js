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
  this._peers = this.options.peers;
  this.subscriptions = {};
  this.subscriptions.block = [];
  this.subscriptions.transaction = [];
  this.messages = new p2p.Messages({ network: this.node.network });

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
  if (this._peers) {
    opts.addrs = this._peers;
    opts.dnsSeed = false;
  }
  opts.maxPeers = this._maxPeers;
  opts.network = this.node.getNetworkName();
  this._pool = new p2p.Pool(opts);
};

P2P.prototype._setupListeners = function() {
  var self = this;

  self._pool.on('peerready', function(peer, addr) {

    log.info('Connected to peer: ' + addr.ip.v4 + ', network: ' +
    peer.network.alias + ', version: ' + peer.version + ', subversion: ' +
    peer.subversion + ', status: ' + peer.status + ', port: ' +
    peer.port + ', best height: ' + peer.bestHeight);
    peer.sendMessage(self.messages.MemPool());
  });

  self._pool.on('peerdisconnect', function(peer, addr) {

    log.info('Disconnected from peer: ' + addr.ip.v4);

  });

  self._pool.on('peerinv', function(peer, message) {

    var newDataNeeded = [];


    message.inventory.forEach(function(inv) {

      if (!self._inv.get(inv.hash)) {

        self._inv.set(inv.hash, true);

        //self._generateRetrievalMessage()
        newDataNeeded.push(inv);

      }

    });

    if (newDataNeeded.length > 0) {
      peer.sendMessage(self.messages.GetData(newDataNeeded));
    }

  });

  self._pool.on('peertx', self._broadcastTx.bind(self));
  self._pool.on('peerblock', self._broadcastBlock.bind(self));

  self.node.on('ready', function() {
    setTimeout(function() {
      self._pool.connect();
    }, 1000);
  });

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
  ];
};

module.exports = P2P;
