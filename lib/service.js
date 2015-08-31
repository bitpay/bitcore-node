'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

var Service = function(options) {
  EventEmitter.call(this);

  this.node = options.node;
};

util.inherits(Service, EventEmitter);

/**
 * Describes the dependencies that should be loaded before this service.
 */
Service.dependencies = [];

/**
 * blockHandler
 * @param {Block} block - the block being added or removed from the chain
 * @param {Boolean} add - whether the block is being added or removed
 * @param {Function} callback - call with the leveldb database operations to perform
 */
Service.prototype.blockHandler = function(block, add, callback) {
  // implement in the child class
  setImmediate(callback);
};

/**
 * the bus events available for subscription
 * @return {Array} an array of event info
 */
Service.prototype.getPublishEvents = function() {
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
Service.prototype.getAPIMethods = function() {
  // Example:
  // return [
  //   ['getData', this, this.getData, 1]
  // ];

  return [];
};

// Example:
// Service.prototype.getData = function(arg1, callback) {
//
// };

Service.prototype.start = function(done) {
  setImmediate(done);
};

Service.prototype.stop = function(done) {
  setImmediate(done);
};

module.exports = Service;
