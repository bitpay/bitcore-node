'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var index = require('../../');
var log = index.log;
var bcoin = require('bcoin');

var BcoinService = function(options) {
  BaseService.call(this, options);
  this._config = options.config || this._getDefaultConfig();
};

inherits(BcoinService, BaseService);

BcoinService.dependencies = [];

BcoinService.prototype._getDefaultConfig = function() {
  return {
    checkpoints: true,
    logLevel: 'info',
    network: this.node.getNetworkName()
  };
};

BcoinService.prototype.start = function(callback) {
  this._startBcoin(callback);
};

BcoinService.prototype._startBcoin = function(callback) {
  var self = this;
  self._bcoin = bcoin.fullnode(self._config);
  self._initBcoinListeners();
  log.info('Starting Bcoin full node...');
  self._bcoin.open().then(function() {
    self._bcoin.connect().then(function() {
      self._bcoin.startSync();
      callback();
    });
  });
};

BcoinService.prototype.stop = function(callback) {
  this._bcoin.stopSync();
  this._bcoin.disconnect();
  this._bcoin.close();
  callback();
};


BcoinService.prototype._initBcoinListeners = function() {

  var self = this;
  self._bcoin.on('error', function(err) {
    log.debug(err);
  });

  self._bcoin.chain.on('block', function(block) {
    log.debug(block);
  });

  self._bcoin.mempool.on('tx', function(tx) {
    log.debug(tx);
  });

  self._bcoin.chain.on('full', function() {
  });

};

module.exports = BcoinService;
