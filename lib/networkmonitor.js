'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var p2p = require('bitcore-p2p');
var Peer = p2p.Peer;
var messages = new p2p.Messages();

function NetworkMonitor(eventBus, peer) {
  $.checkArgument(eventBus);
  $.checkArgument(peer);
  this.bus = eventBus;
  this.peer = peer;
  this.setupPeer(peer);
}
util.inherits(NetworkMonitor, EventEmitter);

NetworkMonitor.create = function(eventBus, opts) {
  opts = opts || {};
  var network = Networks.get(opts.network) || Networks.defaultNetwork;
  var host = opts.host || 'localhost';
  var port = opts.port || Networks.defaultNetwork.port;
  var peer = new Peer(host, port, network);
  return new NetworkMonitor(eventBus, peer);
};

NetworkMonitor.RECONNECT_DELAY = 3000;

NetworkMonitor.prototype.setupPeer = function(peer) {
  var self = this;
  peer.on('ready', function() {
    self.emit('ready');
  });
  peer.on('inv', function(m) {
    // TODO only ask for data if tx or block is unknown
    peer.sendMessage(messages.GetData(m.inventory));
  });
  peer.on('tx', function(m) {
    self.bus.process(m.transaction);
  });
  peer.on('block', function(m) {
    self.bus.process(m.block);
  });
  peer.on('disconnect', function() {
    self.emit('disconnect');
    self._reconnect();
  });
  peer.on('error', function(err) {
    self.emit('error', err);
    self._reconnect();
  });
};

NetworkMonitor.prototype._reconnect = function() {
  setTimeout(this.peer.connect.bind(this.peer), NetworkMonitor.RECONNECT_DELAY)
};

NetworkMonitor.prototype.start = function() {
  this.peer.connect();
};


module.exports = NetworkMonitor;
