'use strict';


var config = require('config');

var bitcore = require('bitcore');

var NetworkMonitor = require('./lib/networkmonitor');
var EventBus = require('./lib/eventbus');


var bus = new EventBus();
var nm = NetworkMonitor.create(bus, config.get('NetworkMonitor'));

bus.register(bitcore.Transaction, function(tx) {
  console.log('Transaction:', tx.id);
});

bus.register(bitcore.Block, function(block) {
  console.log('Block:', block.id);
});

nm.start();



