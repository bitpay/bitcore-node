'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var p2p = require('bitcore-p2p');
var messages = new p2p.Messages();
var $ = bitcore.util.preconditions;

var NetworkMonitor = require('./networkmonitor');
var EventBus = require('./eventbus');
var BlockService = require('./services/block.js');

var BitcoreNode = function(bus, nm) {
  $.checkArgument(bus);
  $.checkArgument(nm);
  var self = this;
  this.bus = bus;
  this.nm = nm;

  this.bs = new BlockService();

  this.bus.register(bitcore.Block, this.bs.onBlock.bind(this.bs));

  this.bus.onAny(function(value) {
    self.emit(this.event, value);
  });
  this.nm.on('error', function(err) {
    self.emit('error', err);
  });
  this.nm.on('disconnect', function() {
    console.log('network monitor disconnected');
  });

};
util.inherits(BitcoreNode, EventEmitter);

BitcoreNode.create = function(opts) {
  opts = opts || {};
  var bus = new EventBus();
  var nm = NetworkMonitor.create(bus, opts.NetworkMonitor);
  return new BitcoreNode(bus, nm);
};

BitcoreNode.prototype.start = function() {
  this.sync();
  this.nm.start();
};

BitcoreNode.prototype.sync = function() {
  var genesis = bitcore.Networks.defaultNetwork.genesis;
  console.log(bitcore.Networks.defaultNetwork.name);
  console.log(genesis);
  var self = this;
  this.nm.on('ready', function() {
    console.log('ready');
    self.bs.getLatest().then(function(latest) {
        var start = genesis;
        if (latest) {
          start = latest.rawHash;
        }
        console.log('Starting sync from', start);
        self.nm.syncFrom(start);
      })
      .catch(function(err) {
        self.nm.disconnect();
        throw err;
      });
  });
};


module.exports = BitcoreNode;
