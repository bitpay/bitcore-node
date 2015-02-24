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
var logger = require('./logger');

function NetworkMonitor(eventBus, opts) {
  $.checkArgument(eventBus instanceof EventBus);
  this.bus = eventBus;

  opts = opts || {};
  opts.network = opts.network || Networks.defaultNetwork;
  opts.host = opts.host || 'localhost';
  opts.port = opts.port || Networks.defaultNetwork.port;

  var peer = new Peer(opts.host, opts.port, opts.network);
  this.peer = peer;
  this.setupPeer(peer);
}
util.inherits(NetworkMonitor, EventEmitter);


NetworkMonitor.prototype.setupPeer = function(peer) {
  var self = this;

  peer.on('ready', function() {
    logger.info('NetworkMonitor: connected to the bitcoin network.');
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
