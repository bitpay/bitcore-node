'use strict';

var index = require('../../');
var log = index.log;
var bcoin = require('bcoin');
var EE = require('events').EventEmitter;

var Bcoin = function(options) {
  this._config = this._getConfig(options);
  this.emitter = new EE();
};

Bcoin.prototype._getConfig = function(options) {
  var config = {
    checkpoints: true,
    network: options.network || 'main',
    listen: true
  };
  if (options.prefix) {
    config.prefix = options.prefix;
  }
  if (options.logLevel) {
    config.logLevel = options.logLevel;
  }
  return config;
};

Bcoin.prototype.start = function() {
  var self = this;
  self._bcoin = bcoin.fullnode(self._config);

  log.info('Starting Bcoin full node...');

  self._bcoin.open().then(function() {
    self._bcoin.connect().then(function() {
      self.emitter.emit('connect');
      self._bcoin.startSync();
    });
  });
};

Bcoin.prototype.stop = function() {
  this._bcoin.stopSync();
  this._bcoin.disconnect();
  this._bcoin.close();
};

module.exports = Bcoin;
