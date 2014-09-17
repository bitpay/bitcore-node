/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 * A bitcoind node.js binding.
 */

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('../build/Release/bitcoindjs.node');
var util = require('util');

/**
 * Bitcoin
 */

function Bitcoin(options) {
  var self = this;

  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  EventEmitter.call(this);

  this.options = options;
}

Bitcoin.prototype.__proto__ = EventEmitter.prototype;

Bitcoin.prototype.start = function(callback) {
  var self = this;

  this.log_pipe = bitcoindjs.start(function(err, status) {
    if (callback) {
      callback(err);
      callback = null;
    }
    if (err) {
      self.emit('error', err);
    } else {
      self.emit('open', status);
    }
  });

  // bitcoind's boost threads aren't in the thread pool
  // or on node's event loop, so we need to keep node open.
  this._interval = setInterval(function() {
    if (bitcoindjs.stopped()) {
      clearInterval(self._interval);
      delete self._interval;
    }
  }, 10000);

  return this.log('log pipe opened: %d', this.log_pipe);
};

Bitcoin.prototype.log =
Bitcoin.prototype.info = function() {
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stdout.write('bitcoind: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stdout.write('bitcoind: ' + out + '\n');
};

Bitcoin.prototype.error = function() {
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stderr.write('bitcoind: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stderr.write('bitcoind: ' + out + '\n');
};

Bitcoin.prototype.stop =
Bitcoin.prototype.close = function(callback) {
  var self = this;
  if (this._interval) {
    clearInterval(this._interval);
    delete this._interval;
  }
  return bitcoindjs.stop(function(err, status) {
    if (err) {
      self.error(err.message);
    } else {
      self.log(status);
    }
    if (!callback) return;
    return callback(err, status);
  });
};

/**
 * Expose
 */

module.exports = exports = Bitcoin;
exports.Bitcoin = Bitcoin;
exports.native = bitcoindjs;
