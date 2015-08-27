'use strict';

var colors = require('colors/safe');

/**
 * Wraps console.log with some special magic
 * @constructor
 */
function Logger(namespace) {
  this.namespace = namespace || 'bitcore-node';
}

/**
 * Prints an info message
 * #info
 */
Logger.prototype.info = function() {
  this._log.apply(this, ['blue', 'info'].concat(Array.prototype.slice.call(arguments)));
};

/**
 * Prints an error message
 * #error
 */
Logger.prototype.error = function() {
  this._log.apply(this, ['red', 'error'].concat(Array.prototype.slice.call(arguments)));
};

/**
 * Prints an debug message
 * #debug
 */
Logger.prototype.debug = function() {
  this._log.apply(this, ['magenta', 'debug'].concat(Array.prototype.slice.call(arguments)));
};

/**
 * Prints an warn message
 * #warn
 */
Logger.prototype.warn = function() {
  this._log.apply(this, ['yellow', 'warn'].concat(Array.prototype.slice.call(arguments)));
};

/**
 * Proxies console.log with color and arg parsing magic
 * #_log
 */
Logger.prototype._log = function(color, type) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  var args = Array.prototype.slice.call(arguments);
  args = args.slice(1);
  var name = colors.bold('{' + this.namespace + '}');
  var type = colors[color].italic(args.shift() + ':');
  args[0] = name + ' ' + type + ' ' + args[0];
  console.log.apply(console, args);
};

module.exports = Logger;
