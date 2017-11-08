'use strict';

var index = require('../../');
var log = index.log;
var bcoin = require('bcoin');

var Bcoin = function(options) {
  this._config = this._getConfig(options);
};

Bcoin.prototype.start = function(callback) {
  var self = this;
  self._bcoin = bcoin.fullnode(self._config);

  log.info('Starting Bcoin full node...');

  self._bcoin.open().then(function() {
    self._bcoin.connect().then(function() {
      log.info('Waiting for Bcoin to sync');
      self._bcoin.startSync();
      // this will instruct the p2p service to start trying to connect to bcoin right away
      callback();
    });
  });
};

Bcoin.prototype.stop = function() {
  this._bcoin.stopSync();
  this._bcoin.disconnect();
  this._bcoin.close();
};

// --- privates

Bcoin.prototype._getConfig = function(options) {
  var config = {
    db: 'leveldb',
    checkpoints: true,
    network: options.network || 'main',
    listen: true,
    logConsole: true,
    logLevel: 'info',
    port: options.port,
    persistent: true,
    workers: true
  };
  if (options.prefix) {
    config.prefix = options.prefix;
  }
  return config;
};

module.exports = Bcoin;
