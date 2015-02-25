'use strict';


var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var p2p = require('bitcore-p2p');
var Promise = require('bluebird');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var EventBus = require('./eventbus');
var Peer = p2p.Peer;
var Messages = p2p.Messages;

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
  opts.network = opts.network || Networks.defaultNetwork;
  opts.host = opts.host || 'localhost';
  opts.port = opts.port || Networks.defaultNetwork.port;

  var peer = new Peer(opts.host, opts.port, opts.network);
  return new NetworkMonitor(eventBus, peer);
};

NetworkMonitor.prototype.setupPeer = function(peer) {
  var self = this;

  peer.on('ready', function() {
    self.emit('ready');
  });
  peer.on('inv', function(m) {
    // TODO only ask for data if tx or block is unknown
    peer.sendMessage(new Messages.GetData(m.inventory));
  });
  peer.on('tx', function(m) {
    self.bus.process(m.transaction);
  });
  peer.on('block', function(m) {
    self.bus.process(m.block);
  });
};

NetworkMonitor.prototype.start = function() {
  this.peer.connect();
};


module.exports = NetworkMonitor;
