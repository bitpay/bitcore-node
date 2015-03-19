'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;

var NetworkMonitor = require('./networkmonitor');
var EventBus = require('./eventbus');

var BitcoreNode = function(bus, nm) {
  $.checkArgument(bus);
  $.checkArgument(nm);
  var self = this;
  this.bus = bus;
  this.nm = nm;

  this.bus.onAny(function(value) {
    self.emit(this.event, value);
  });
  this.nm.on('error', function(err) {
    self.emit('error', err);
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
  this.nm.start();
};

module.exports = BitcoreNode;
