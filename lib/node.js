'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var Unit = bitcore.Unit;
var $ = bitcore.util.preconditions;

var NetworkMonitor = require('./networkmonitor');
var EventBus = require('./eventbus');

var BitcoreNode = function(bus, nm) {
  $.checkArgument(bus);
  $.checkArgument(nm);
  var self = this;
  this.bus = bus;
  this.nm = nm;

  this.bus.register(bitcore.Transaction, function(tx) {
    var tout = Unit.fromSatoshis(tx.outputAmount).toBTC();
    console.log('Transaction:', tx.id);
    console.log('\ttotal_out:', tout, 'BTC');
  });

  this.bus.register(bitcore.Block, function(block) {
    console.log('Block:', block.id);
  });

  this.bus.onAny(function(value) {
    self.emit(this.event, value);
  });
  this.nm.on('error', function(err) {
    self.emit('error', err);
  });
  this.on('error', function(err) {
    console.log('Bitcoind connection failed:', err);
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
