'use strict';

var Module = function(options) {
  this.db = options.db;
};

Module.prototype.blockHandler = function(block, add, callback) {
  // implement in the child class
  setImmediate(callback);
};

Module.prototype.methods = function() {
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

module.exports = Module;