'use strict';


var config = require('config');
var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var Unit = bitcore.Unit;

var NetworkMonitor = require('./lib/networkmonitor');
var EventBus = require('./lib/eventbus');

var BitcoreNode = function(bus, nm) {
  var self = this;
  this.bus = bus;
  this.nm = nm;

  this.bus.register(bitcore.Transaction, function(tx) {
    var tout = Unit.fromSatoshis(tx.outputAmount).toBTC();
    console.log('Transaction:', tx.id, 'total_out:', tout, 'BTC');
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
};
util.inherits(BitcoreNode, EventEmitter);

BitcoreNode.create = function(opts) {
  var bus = new EventBus();
  var nm = NetworkMonitor.create(bus, opts.NetworkMonitor);
  return new BitcoreNode(bus, nm);
};

BitcoreNode.prototype.start = function() {
  this.nm.start();
};


if (require.main === module) {
  var node = BitcoreNode.create(config.get('BitcoreNode'));
  node.start();
  node.on('error', function(err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('Connection to bitcoind failed');
    } else {
      console.log('Unrecognized error: ', err);
    }
  });
}

module.exports = BitcoreNode;
