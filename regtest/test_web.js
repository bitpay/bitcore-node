'use strict';

var BaseService = require('../lib/service');
var inherits = require('util').inherits;

var TestWebService = function(options) {
  BaseService.call(this, options);
};

inherits(TestWebService, BaseService);

TestWebService.dependencies = ['web', 'block'];

TestWebService.prototype.start = function(callback) {
  callback();
};

TestWebService.prototype.stop = function(callback) {
  callback();
};

TestWebService.prototype.setupRoutes = function(app) {

  var self = this;

  app.get('/hash/:height', function(req, res) {
    self.node.services.block.getBlockHash(req.params.height, function(err, hash) {
      res.status(200).jsonp({ hash: hash, height: parseInt(req.params.height) });
    });
  });

  app.get('/height/:hash', function(req, res) {
    self.node.services.block.getBlockHeight(req.params.hash, function(err, height) {
      res.status(200).jsonp({ hash: req.params.hash, height: height });
    });
  });

};

TestWebService.prototype.getRoutePrefix = function() {
  return 'test';
};

module.exports = TestWebService;
