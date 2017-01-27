'use strict';

/**
 * The UntrustedMempool Service builds upon the Database Service. It is also an adjunct to the
 * Transaction Service's memory pool to provide block explorers the chance to report on
 * transactions that are bouncing around bitcoin's peer network, but are not necessarily going
 * to be validated into your trusted node's memory pool or even sent over the zmq socket.
 * The strategy is to permanently save txs in the database that are unlikely to ever make it
 * into a block. The reason for this is so the block explorer can have a historical record of these
 * transactions. There is also an LRU cache that contains all of the transactions from the pool,
 * regardless of validation status. When a block comes in, we can prune out the transactions that
 * exist in the block because we know the transaction service has already indexed them.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 * @param {Integer} options.maxPeers - An optional number of maximum peers to connect to
 * @param {Array} options.peers - A list of ip addresses to explicitly connect to (this disables use of seeds)
 * @param {Integer} options.maxMempoolSize - Maximum size of the mempool in this service
 */

var p2p = require('bitcore-p2p');
var Peer = p2p.Peer;
var messages = new p2p.Messages();
var LRU = require('lru-cache');
var util = require('util');
var _ = require('lodash');
var bitcore = require('bitcore-lib');
var index = require('../');
var log = index.log;
var Service = require('../service');

var UntrustedMempool = function(options) {
  if (!(this instanceof UntrustedMempool)) {
    return new UntrustedMempool(options);
  }
  Service.call(this, options);
  this.options = options;
  this._maxPeers = this.options.maxPeers || 60;
  this._peers = this.options.peers;
  this._maxMempoolSize = this.options.maxMempoolSize || 100 * 1024 * 1024;
  this._synced = false;
};

util.inherits(UntrustedMempool, Service);

UntrustedMempool.dependencies = [ bitcoind, db ];

UntrustedMempool.prototype.start = function(callback) {
  var self = this;
  self.once('synced', function() {
    self._initPrefix(callback);
    self._initPool();
    self._initCache();
    self._pool.connect();
    self._synced = true;
  });
};

UntrustedMempool.prototype.stop = function(callback) {
  var self = this;
  setImmediate(function() {
    self._pool.disconnect();
    callback();
  });
};

UntrustedMempool.prototype._initPrefix = function(callback) {
  var self = this;
  self.node.services.db.getPrefix(self.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;
    callback();
  });
};

UntrustedMempool.prototype._initCache = function() {
  this._inv = LRU(2000);
  this._cache = LRU({
    max: this._maxMempoolSize,
    length: function(tx) { return tx.toBuffer().length; }
  });
};

UntrustedMempool.prototype._initPool = function() {
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

UntrustedMempool.prototype._setupListeners = function() {
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
    if (validTx(tx)) {
      return self._cache.set(tx.id, tx);
    }
    return self._operations.push({
      type: 'put',
      key: new Buffer(tx.id),
      value: tx.toBuffer()
    });
  });
};

UntrustedMempool.prototype.getAPIMethods = function() {
  return [];
};

UntrustedMempool.prototype.getPublishEvents = function() {
  return [];
};

UntrustedMempool.prototype.blockHandler = function(block, connected, callback) {
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

module.exports = UntrustedMempool;
