'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var assert = require('assert');
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var index = require('./');
var log = index.log;
var Bus = require('./bus');
var errors = require('./errors');

function Node(config) {

  if(!(this instanceof Node)) {
    return new Node(config);
  }

  this._init(config);

  if (!_.isUndefined(config.formatLogs)) {
    this.log.formatting = config.formatLogs ? true : false;
  }

  if (config.services) {
    this._unloadedServices = config.services;
  }
}

util.inherits(Node, EventEmitter);

Node.prototype._init = function(config) {
  this.configPath = config.path;
  this.errors = errors;
  this.log = log;

  this.datadir = config.datadir;
  this.network = null;
  this.services = {};
  this._unloadedServices = [];

  this.port = config.port;
  this.https = config.https;
  this.httpsOptions = config.httpsOptions;
  this._setNetwork(config);
};

Node.prototype._setNetwork = function(config) {
  this.network = config.network;
};

Node.prototype.openBus = function(options) {
  if (!options) {
    options = {};
  }
  return new Bus({node: this, remoteAddress: options.remoteAddress});
};

Node.prototype.getAllAPIMethods = function() {
  var methods = [];
  for(var i in this.services) {
    var mod = this.services[i];
    if (mod.getAPIMethods) {
      methods = methods.concat(mod.getAPIMethods());
    }
  }
  return methods;
};

Node.prototype.getAllPublishEvents = function() {
  var events = [];
  for (var i in this.services) {
    var mod = this.services[i];
    if (mod.getPublishEvents) {
      events = events.concat(mod.getPublishEvents());
    }
  }
  return events;
};

Node.prototype._getServiceOrder = function(services) {

  var names = [];
  var servicesByName = {};
  for (var i = 0; i < services.length; i++) {
    var service = services[i];
    names.push(service.name);
    servicesByName[service.name] = service;
  }

  var stackNames = {};
  var stack = [];

  function addToStack(names) {
    for(var i = 0; i < names.length; i++) {

      var name = names[i];
      var service = servicesByName[name];
      assert(service, 'Required dependency "' + name + '" not available.');

      addToStack(service.module.dependencies);

      if(!stackNames[name]) {
        stack.push(service);
        stackNames[name] = true;
      }

    }
  }

  addToStack(names);

  return stack;
};

Node.prototype._startService = function(serviceInfo, callback) {
  var self = this;

  log.info('Starting ' + serviceInfo.name);

  var config;
  if (serviceInfo.config) {
    assert(_.isObject(serviceInfo.config));
    assert(!serviceInfo.config.node);
    assert(!serviceInfo.config.name);
    config = serviceInfo.config;
  } else {
    config = {};
  }

  config.node = this;
  config.name = serviceInfo.name;
  var service = new serviceInfo.module(config);

  self.services[serviceInfo.name] = service;

  service.start(function(err) {
    if (err) {
      return callback(err);
    }

    if (service.getAPIMethods) {
      var methodData = service.getAPIMethods();
      var methodNameConflicts = [];
      methodData.forEach(function(data) {
        var name = data[0];
        var instance = data[1];
        var method = data[2];

        if (self[name]) {
          methodNameConflicts.push(name);
        } else {
          self[name] = function() {
            return method.apply(instance, arguments);
          };
        }
      });

      if (methodNameConflicts.length > 0) {
        return callback(new Error('Existing API method(s) exists: ' + methodNameConflicts.join(', ')));
      }
    }

    callback();

  });

};

Node.prototype._logTitle = function() {
  if (this.configPath) {
    log.info('Using config:', this.configPath);
    log.info('Using network:', this.network);
  }
};

Node.prototype.start = function(callback) {
  var self = this;

  var services = this._unloadedServices;

  var servicesOrder = this._getServiceOrder(services);

  self._logTitle();

  async.eachSeries(
    servicesOrder,
    function(service, next) {
      self._startService(service, next);
    },
    function(err) {

      if (err) {
        return callback(err);
      }

      self.emit('ready');
      callback();
    }
  );
};

Node.prototype.stop = function(callback) {

  log.info('Beginning shutdown');
  var self = this;
  var services = this._getServiceOrder(this._unloadedServices).reverse();

  this.stopping = true;
  this.emit('stopping');

  async.eachSeries(

   services,
   function(service, next) {
     if (self.services[service.name]) {
       log.info('Stopping ' + service.name);
       self.services[service.name].stop(next);
     } else {
       log.info('Stopping ' + service.name + ' (not started)');
       setImmediate(next);
     }
   },
   function() {
     if (callback) {
       callback();
     }
  });
};

module.exports = Node;
