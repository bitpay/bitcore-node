'use strict';

var assert = require('assert');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var index = require('../../');
var log = index.log;
var BitcoreRPC = require('bitcoind-rpc');

var FeeService = function(options) {
  this._config = options.rpc || {
    user: 'bitcoin',
    pass: 'local321',
    host: 'localhost',
    protocol: 'http',
    port: this._getDefaultPort()
  };
  BaseService.call(this, options);

};

inherits(FeeService, BaseService);

FeeService.dependencies = [];

FeeService.prototype.start = function() {
  return this.node.network.port - 1;
};

FeeService.prototype.start = function(callback) {
  callback();
};

FeeService.prototype.stop = function(callback) {
  callback();
};

FeeService.prototype.getAPIMethods = function() {
  return [
    ['estimateFee', this, this.estimateFee, 1]
  ];
};

FeeService.prototype.estimateFee = function(blocks, callback) {
  var client = new BitcoreRPC(this._config);
  client.estimateFee(blocks || 4, callback);
};




module.exports = FeeService;

