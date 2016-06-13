'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var index = require('./');
var log = index.log;
var Bus = require('./bus');
var errors = require('./errors');

/**
 * A node is a hub of services, and will manage starting and stopping the services in
 * the correct order based the the dependency chain. The node also holds common configuration
 * properties that can be shared across services, such as network settings.
 *
 * The array of services should have the format:
 * ```js
 * {
 *   name: 'bitcoind',
 *   config: {}, // options to pass into constructor
 *   module: ServiceConstructor
 * }
 * ```
 *
 * @param {Object} config - The configuration of the node
 * @param {Array} config.formatLogs - Option to disable formatting of logs
 * @param {Array} config.services - The array of services
 * @param {Number} config.port - The HTTP port for services
 * @param {Boolean} config.https - Enable https
 * @param {Object} config.httpsOptions - Options for https
 * @param {String} config.httpsOptions.key - Path to key file
 * @param {String} config.httpsOptions.cert - Path to cert file
 * @param {}
 */
function Node(config) {
  /* jshint maxstatements: 20 */
  if(!(this instanceof Node)) {
    return new Node(config);
  }
  this.configPath = config.path;
  this.errors = errors;
  this.log = log;

  if (!_.isUndefined(config.formatLogs)) {
    this.log.formatting = config.formatLogs ? true : false;
  }

  this.network = null;
  this.services = {};
  this._unloadedServices = [];

  // TODO type check the arguments of config.services
  if (config.services) {
    $.checkArgument(Array.isArray(config.services));
    this._unloadedServices = config.services;
  }
  this.port = config.port;
  this.https = config.https;
  this.httpsOptions = config.httpsOptions;
  this._setNetwork(config);
}

util.inherits(Node, EventEmitter);

/**
 * Will set the this.network based on a network string.
 * @param {Object} config
 * @param {String} config.network - Possible options "testnet", "regtest" or "livenet"
 */
Node.prototype._setNetwork = function(config) {
  if (config.network === 'testnet') {
    this.network = Networks.get('testnet');
  } else if (config.network === 'regtest') {
    Networks.enableRegtest();
    this.network = Networks.get('regtest');
  } else {
    this.network = Networks.defaultNetwork;
  }
  $.checkState(this.network, 'Unrecognized network');
};

/**
 * Will instantiate a new Bus for this node.
 * @returns {Bus}
 */
Node.prototype.openBus = function(options) {
  if (!options) {
    options = {};
  }
  return new Bus({node: this, remoteAddress: options.remoteAddress});
};

/**
 * Will get an array of API method descriptions from all of the available services.
 * @returns {Array}
 */
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

/**
 * Will get an array of events from all of the available services.
 * @returns {Array}
 */
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

/**
 * Will organize services into the order that they should be started
 * based on the service's dependencies.
 * @returns {Array}
 */
Node.prototype.getServiceOrder = function() {

  var services = this._unloadedServices;

  // organize data for sorting
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
      $.checkState(service, 'Required dependency "' + name + '" not available.');

      // first add the dependencies
      addToStack(service.module.dependencies);

      // add to the stack if it hasn't been added
      if(!stackNames[name]) {
        stack.push(service);
        stackNames[name] = true;
      }

    }
  }

  addToStack(names);

  return stack;
};

/**
 * Will instantiate an instance of the service module, add it to the node
 * services, start the service and add available API methods to the node and
 * checking for any conflicts.
 * @param {Object} serviceInfo
 * @param {String} serviceInfo.name - The name of the service
 * @param {Object} serviceInfo.module - The service module constructor
 * @param {Object} serviceInfo.config - Options to pass into the constructor
 * @param {Function} callback - Called when the service is started
 * @private
 */
Node.prototype._startService = function(serviceInfo, callback) {
  var self = this;

  log.info('Starting ' + serviceInfo.name);

  var config;
  if (serviceInfo.config) {
    $.checkState(_.isObject(serviceInfo.config));
    $.checkState(!serviceInfo.config.node);
    $.checkState(!serviceInfo.config.name);
    config = serviceInfo.config;
  } else {
    config = {};
  }

  config.node = this;
  config.name = serviceInfo.name;
  var service = new serviceInfo.module(config);

  // include in loaded services
  self.services[serviceInfo.name] = service;

  service.start(function(err) {
    if (err) {
      return callback(err);
    }

    // add API methods
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
    log.info('Using network:', this.getNetworkName());
  }
};


/**
 * Will start all running services in the order based on the dependency chain.
 * @param {Function} callback - Called when all services are started
 */
Node.prototype.start = function(callback) {
  var self = this;
  var servicesOrder = this.getServiceOrder();

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

Node.prototype.getNetworkName = function() {
  var network = this.network.name;
  if (this.network.regtestEnabled) {
    network = 'regtest';
  }
  return network;
};

/**
 * Will stop all running services in the reverse order that they
 * were initially started.
 * @param {Function} callback - Called when all services are stopped
 */
Node.prototype.stop = function(callback) {
  log.info('Beginning shutdown');
  var self = this;
  var services = this.getServiceOrder().reverse();

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
    callback
  );
};

module.exports = Node;
