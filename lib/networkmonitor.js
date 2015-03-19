'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
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
  var host = opts.host || 'localhost';
  var port = opts.port || Networks.defaultNetwork.port;
  var peer = new Peer(host, port, Networks.defaultNetwork);
  return new NetworkMonitor(eventBus, peer);
};

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
    self.bus.process(m.transaction)
      .catch(function(err) {
        self.stop(err);
      });
    //.catch(self.stop.bind(self));
  });
  peer.on('block', function(m) {
    self.bus.process(m.block)
      .catch(function(err) {
        self.stop(err);
      });
    //.catch(self.stop.bind(self));
  });
  peer.on('error', function(err) {
    self.emit('error', err);
    self.stop(err);
  });
  peer.on('disconnect', function() {
    self.emit('disconnect');
  });

};

NetworkMonitor.prototype.start = function() {
  this.peer.connect();
};
NetworkMonitor.prototype.stop = function(reason) {
  this.peer.disconnect();
  if (reason) {
    throw reason;
  }
};

NetworkMonitor.prototype.syncFrom = function(start) {
  $.checkArgument(_.isString(start), 'start must be a block hash string');
  this.peer.sendMessage(messages.GetBlocks([start]));
};

module.exports = NetworkMonitor;
