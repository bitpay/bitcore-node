'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird').Promise;

var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var p2p = require('bitcore-p2p');
var Peer = p2p.Peer;

function NetworkMonitor(eventBus, peer) {
  $.checkArgument(eventBus);
  $.checkArgument(peer);
  this.bus = eventBus;
  this.peer = peer;
  this.messages = new p2p.Messages({
    network: this.peer.network,
  });
  this.ignoreInv = true;
  this.setupPeer(peer);
}
util.inherits(NetworkMonitor, EventEmitter);

NetworkMonitor.create = function(eventBus, opts) {
  opts = opts || {};
  var host = opts.host || 'localhost';
  var port = opts.port || Networks.defaultNetwork.port;
  var peer = new Peer({
    host: host,
    port: port,
    network: Networks.defaultNetwork
  });
  return new NetworkMonitor(eventBus, peer);
};

NetworkMonitor.prototype.setupPeer = function(peer) {
  var self = this;

  peer.on('ready', function() {
    self.emit('ready', self.maxHeight);
  });
  peer.on('version', function(m) {
    self.maxHeight = m.startHeight;
  });
  peer.on('inv', function(m) {
    if(self.ignoreInv) {
      return;
    }

    self.emit('inv', m.inventory);
    // TODO only ask for data if tx or block is unknown
    peer.sendMessage(self.messages.GetData(m.inventory));
  });
  peer.on('tx', function(m) {
    self.bus.process(m.transaction)
      .catch(function(err) {
        self.abort(err);
      });
  });
  peer.on('block', function(m) {
    self.bus.process(m.block)
      .catch(function(err) {
        self.abort(err);
      });
  });
  peer.on('error', function(err) {
    self.emit('error', err);
    self.abort(err);
  });
  peer.on('disconnect', function() {
    self.emit('disconnect');
  });

};

NetworkMonitor.prototype.requestBlocks = function(locator) {
  $.checkArgument(_.isArray(locator) &&
    _.isUndefined(locator[0]) ||
    _.isString(locator[0]), 'start must be a block hash string array');
  this.peer.sendMessage(this.messages.GetBlocks({
    starts: locator,
  }));
};

NetworkMonitor.prototype.broadcast = function(tx) {
  $.checkArgument(tx instanceof bitcore.Transaction, 'tx must be a Transaction object');
  this.peer.sendMessage(this.messages.Transaction(tx));
  return Promise.resolve();
};

NetworkMonitor.prototype.start = function() {
  console.log('starting network monitor');
  this.peer.connect();
};

NetworkMonitor.prototype.stop = function(reason) {
  this.peer.disconnect();
  console.log('Stopping network, reason:', reason);
};

NetworkMonitor.prototype.getConnectedPeers = function() {
  // TODO: update when using Pool instead of Peer
  return this.peer.status === Peer.STATUS.READY ? 1 : 0;
};

NetworkMonitor.prototype.abort = function(reason) {
  // TODO: improve Peer interface to know if it's connected
  if (this.peer.socket) {
    this.peer.disconnect();
  }
  if (reason) {
    throw reason;
  }
};

module.exports = NetworkMonitor;
