'use strict';

var BaseModule = require('../module');
var inherits = require('util').inherits;

var Insight = function(options) {
  BaseModule.call(this, options);
};

Insight.info = {
  name: 'insight',
  dependencies: ['address']
};

inherits(Insight, BaseModule);

Insight.prototype.start = function() {
  // Initialize anything we need
};

Insight.prototype.stop = function() {

};

Insight.prototype.setupRoutes = function(app) {
  var prefix = '/' + Insight.info.name;
  app.get('/', function(req, res) {
    res.send(200);
  });
};

module.exports = Insight;