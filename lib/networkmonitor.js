'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

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
    magicNumber: this.peer.network.networkMagic.readUInt32LE(0)
  });
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
    self.emit('ready');
  });
  peer.on('inv', function(m) {
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
    //stop: '000000002c05cc2e78923c34df87fd108b22221ac6076c18f3ade378a4d915e9' // TODO: remove this!!!
  }));
};

NetworkMonitor.prototype.start = function() {
  this.peer.connect();
};

NetworkMonitor.prototype.stop = function(reason) {
  this.peer.disconnect();
  console.log('Stopping network, reason:', reason);
};

NetworkMonitor.prototype.abort = function(reason) {
  this.peer.disconnect();
  if (reason) {
    throw reason;
  }
};

module.exports = NetworkMonitor;
