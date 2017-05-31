'use strict';

var BaseService = require('../lib/service');
var inherits = require('util').inherits;
var zmq = require('zmq');
var index = require('../lib');
var log = index.log;

var TestBusService = function(options) {
  BaseService.call(this, options);
  this._cache = { transaction: [], block: [], headers: [] };
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
    self._cache.transaction.push(tx);
    if (self._ready) {
      for(var i = 0; i < self._cache.transaction.length; i++) {
        var transaction = self._cache.transaction.shift();
        self.pubSocket.send([ 'transaction', new Buffer(transaction.uncheckedSerialize(), 'hex') ]);
      }
      return;
    }
  });

  self.bus.on('p2p/block', function(block) {
    var self = this;
    self._cache.block.push(block);
    if (self._ready) {
      for(var i = 0; i < self._cache.block.length; i++) {
        var blk = self._cache.block.unshift();
        self.pubSocket.send([ 'block', blk.toBuffer() ]);
      }
      return;
    }
  });

  self.bus.subscribe('p2p/transaction');
  self.bus.subscribe('p2p/block');

  self.node.on('ready', function() {


    setTimeout(function() {
      self._ready = true;
      self.node.services.p2p.getMempool(function(err, mempool) {

console.log(mempool);
      });
    }, 2000);

  });

  callback();
};

TestBusService.prototype.stop = function(callback) {
  callback();
};

module.exports = TestBusService;

