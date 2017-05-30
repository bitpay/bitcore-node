'use strict';

var BaseService = require('../lib/service');
var inherits = require('util').inherits;
var zmq = require('zmq');
var index = require('../lib');
var log = index.log;

var TestBusService = function(options) {
  BaseService.call(this, options);
};

inherits(TestBusService, BaseService);

TestBusService.dependencies = ['p2p'];

TestBusService.prototype.start = function(callback) {

  var self = this;
  self.pubSocket = zmq.socket('pub');

  log.info('zmq bound to port: 38332');

  self.pubSocket.bind('tcp://127.0.0.1:38332');

  self.bus = self.node.openBus({ remoteAddress: 'localhost' });

  self.bus.on('p2p/transaction', function(tx) {
    self.pubSocket.send([ 'transaction', new Buffer(tx.uncheckedSerialize(), 'hex') ]);
  });

  self.bus.on('p2p/block', function(block) {
    self.pubSocket.send([ 'block', block.toBuffer() ]);
  });

  self.bus.subscribe('p2p/transaction');
  self.bus.subscribe('p2p/block');

  callback();
};

TestBusService.prototype.stop = function(callback) {
  callback();
};

module.exports = TestBusService;

