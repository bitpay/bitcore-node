'use strict';

var Module = function(options) {
  this.node = options.node;
};

/**
 * Describes the dependencies that should be loaded before this module.
 */
Module.dependencies = [];

/**
 * blockHandler
 * @param {Block} block - the block being added or removed from the chain
 * @param {Boolean} add - whether the block is being added or removed
 * @param {Function} callback - call with the leveldb database operations to perform
 */
Module.prototype.blockHandler = function(block, add, callback) {
  // implement in the child class
  setImmediate(callback);
};

/**
 * the bus events available for subscription
 * @return {Array} an array of event info
 */
Module.prototype.getPublishEvents = function() {
  // Example:
  // return [
  //   ['eventname', this, this.subscribeEvent, this.unsubscribeEvent],
  // ];
  return [];
};

/**
 * the API methods to expose
 * @return {Array} return array of methods
 */
Module.prototype.getAPIMethods = function() {
  // Example:
  // return [
  //   ['getData', this, this.getData, 1]
  // ];

  return [];
};

// Example:
// Module.prototype.getData = function(arg1, callback) {
//
// };

Module.prototype.start = function(done) {
  setImmediate(done);
};

Module.prototype.stop = function(done) {
  setImmediate(done);
};

module.exports = Module;
