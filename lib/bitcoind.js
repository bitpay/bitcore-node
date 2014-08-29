/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 * A bitcoind node.js binding.
 */

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('../build/Release/bitcoindjs.node');

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

  bitcoindjs.start(function(err, status) {
    if (err) {
      self.emit('error', err);
      return;
    }
    self.emit('open', status);
  });
}

Bitcoin.prototype.__proto__ = EventEmitter.prototype;

/**
 * Expose
 */

module.exports = exports = Bitcoin;
exports.Bitcoin = Bitcoin;
exports.native = bitcoindjs;
