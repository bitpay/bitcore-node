'use strict';

var BaseService = require('../lib/service');
var inherits = require('util').inherits;

var TestWebService = function(options) {
  BaseService.call(this, options);
};

inherits(TestWebService, BaseService);

TestWebService.dependencies = ['web', 'block', 'timestamp'];

TestWebService.prototype.start = function(callback) {
  callback();
};

TestWebService.prototype.stop = function(callback) {
  callback();
};

TestWebService.prototype.setupRoutes = function(app) {

  var self = this;

  app.get('/block/hash/:height', function(req, res) {
    self.node.services.block.getBlockHash(req.params.height, function(err, hash) {
      res.status(200).jsonp({ hash: hash, height: parseInt(req.params.height) });
    });
  });

  app.get('/block/height/:hash', function(req, res) {
    self.node.services.block.getBlockHeight(req.params.hash, function(err, height) {
      res.status(200).jsonp({ hash: req.params.hash, height: height });
    });
  });

  app.get('/timestamp/time/:hash', function(req, res) {
    self.node.services.timestamp.getTimestamp(req.params.hash, function(err, timestamp) {
      res.status(200).jsonp({ hash: req.params.hash, timestamp: timestamp });
    });
  });

  app.get('/timestamp/hash/:time', function(req, res) {
    self.node.services.timestamp.getHash(req.params.time, function(err, hash) {
      res.status(200).jsonp({ hash: hash, timestamp: parseInt(req.params.time) });
    });
  });

  app.get('/utxo/:address', function(req, res) {
    self.node.services.utxo.getUtxosForAddress(req.params.address, function(err, utxos) {
      res.status(200).jsonp({ address: req.params.address, utxos: utxos });
    });
  });
};

TestWebService.prototype.getRoutePrefix = function() {
  return 'test';
};

module.exports = TestWebService;
