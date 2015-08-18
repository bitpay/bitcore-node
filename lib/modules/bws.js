'use strict';

var BaseModule = require('../module');
var inherits = require('util').inherits;

var BWS = function(options) {
  BaseModule.call(this, options);
};

inherits(BWS, BaseModule);

BWS.info = function() {
  return {
    name: 'bws', 
    dependencies: ['address']
  }
};

BWS.prototype.start = function() {
  // start up BWS's various services
};

BWS.prototype.stop = function() {
  // stop BWS's various services
};

BWS.prototype.setupRoutes = function(app) {
  // expose BWS's API
};

module.exports = BWS;