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

TestBusService.dependencies = ['p2p', 'web'];

TestBusService.prototype.start = function(callback) {

  var self = this;
  self.pubSocket = zmq.socket('pub');

  log.info('zmq bound to port: 38332');

  self.pubSocket.bind('tcp://127.0.0.1:38332');

  self.bus = self.node.openBus({ remoteAddress: 'localhost' });

  self.bus.on('p2p/transaction', function(tx) {
    self._cache.transaction.push(tx);
    if (self._ready) {
      while(self._cache.transaction.length > 0) {
        var transaction = self._cache.transaction.shift();
        self.pubSocket.send([ 'transaction', new Buffer(transaction.uncheckedSerialize(), 'hex') ]);
      }
    }
  });

  self.node.services.p2p.on('bestHeight', function(height) {
    self._bestHeight = height;
  });

  self.bus.on('p2p/block', function(block) {
    self._cache.block.push(block);
    if (self._ready) {
      while(self._cache.block.length > 0) {
        var blk = self._cache.block.shift();
        self.pubSocket.send([ 'block', blk.toBuffer() ]);
      }
    }
  });

  self.bus.on('p2p/headers', function(headers) {
    headers.forEach(function(header) {
      self._cache.headers.push(header);
    });

    if (self._ready) {
      while(self._cache.headers.length > 0) {
        var hdr = self._cache.headers.shift();
        self.pubSocket.send([ 'headers', hdr.toBuffer() ]);
      }
    }
  });

  self.bus.subscribe('p2p/transaction');
  self.bus.subscribe('p2p/block');
  self.bus.subscribe('p2p/headers');

  self.node.on('ready', function() {

    self._ready = true;

  });

  callback();
};

TestBusService.prototype.setupRoutes = function(app) {

  var self = this;

  app.get('/mempool', function(req, res) {
    self.node.services.p2p.clearInventoryCache();
    var filter;
    if (req.query.filter) {
      filter = JSON.parse(req.query.filter);
    }
    self.node.services.p2p.getMempool(filter);
    res.status(200).end();
  });

  app.get('/blocks', function(req, res) {
    self.node.services.p2p.clearInventoryCache();
    var filter;
    if (req.query.filter) {
      filter = JSON.parse(req.query.filter);
    }
    self.node.services.p2p.getBlocks(filter);
    res.status(200).end();
  });

  app.get('/headers', function(req, res) {
    var filter;
    if (req.query.filter) {
      filter = JSON.parse(req.query.filter);
    }
    self.node.services.p2p.getHeaders(filter);
    res.status(200).end();
  });

  app.get('/info', function(req, res) {
    res.status(200).jsonp({ result: (self._ready && (self._bestHeight >= 0))});
  });
};

TestBusService.prototype.getRoutePrefix = function() {
  return 'test';
};

TestBusService.prototype.stop = function(callback) {
  callback();
};

module.exports = TestBusService;

