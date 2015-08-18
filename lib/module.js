'use strict';

var Module = function(options) {
  this.db = options.db;
};

/**
 * Metadata
 * @return {Object} include name and dependencies
 */
Module.info = function() {
  return {
    name: 'module',
    dependencies: []
  }
};

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

/**
 * Function which is called when module is first initialized
 */
Module.prototype.start = function() {

};

/**
 * Function to be called when bitcore-node is stopped
 */
Module.prototype.stop = function() {

};

/**
 * Setup express routes
 * @param  {Express} app
 */
Module.prototype.setupRoutes = function(app) {
  // Setup express routes here
};

module.exports = Module;
