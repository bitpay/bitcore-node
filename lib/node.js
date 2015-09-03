'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var index = require('./');
var log = index.log;
var Bus = require('./bus');
var BaseService = require('./service');
var errors = require('./errors');

function Node(config) {
  if(!(this instanceof Node)) {
    return new Node(config);
  }

  var self = this;

  this.errors = errors; // So services can use errors without having to have bitcore-node as a dependency
  this.log = log;
  this.network = null;
  this.services = {};
  this._unloadedServices = [];

  // TODO type check the arguments of config.services
  if (config.services) {
    $.checkArgument(Array.isArray(config.services));
    this._unloadedServices = config.services;
  }

  $.checkState(config.datadir, 'Node config expects "datadir"');
  this.datadir = config.datadir;
  this.port = config.port;

  this._setNetwork(config);

  this.start(function(err) {
    if(err) {
      return self.emit('error', err);
    }
    self.emit('ready');
  });

}

util.inherits(Node, EventEmitter);

util.inherits(Node, EventEmitter);

Node.prototype._setNetwork = function(config) {
  if (config.network === 'testnet') {
    this.network = Networks.get('testnet');
  } else if (config.network === 'regtest') {
    Networks.remove(Networks.testnet);
    Networks.add({
      name: 'regtest',
      alias: 'regtest',
      pubkeyhash: 0x6f,
      privatekey: 0xef,
      scripthash: 0xc4,
      xpubkey: 0x043587cf,
      xprivkey: 0x04358394,
      networkMagic: 0xfabfb5da,
      port: 18444,
      dnsSeeds: [ ]
    });
    this.network = Networks.get('regtest');
  } else {
    this.network = Networks.defaultNetwork;
  }
  $.checkState(this.network, 'Unrecognized network');
};

Node.prototype.openBus = function() {
  return new Bus({node: this});
};

Node.prototype.getAllAPIMethods = function() {
  var methods = [];
  for(var i in this.services) {
    var mod = this.services[i];
    methods = methods.concat(mod.getAPIMethods());
  }
  return methods;
};

Node.prototype.getAllPublishEvents = function() {
  var events = [];
  for (var i in this.services) {
    var mod = this.services[i];
    events = events.concat(mod.getPublishEvents());
  }
  return events;
};

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

Node.prototype._instantiateService = function(service) {
  var self = this;

  $.checkState(_.isObject(service.config));
  $.checkState(!service.config.node);

  var config = service.config;
  config.node = this;
  config.name = service.name;
  var mod = new service.module(config);

  // include in loaded services
  this.services[service.name] = mod;

  // add API methods
  var methodData = mod.getAPIMethods();
  methodData.forEach(function(data) {
    var name = data[0];
    var instance = data[1];
    var method = data[2];

    if (self[name]) {
      throw new Error('Existing API method exists: ' + name);
    } else {
      self[name] = function() {
        return method.apply(instance, arguments);
      };
    }
  });
};

Node.prototype.start = function(callback) {
  var self = this;
  var servicesOrder = this.getServiceOrder();

  async.eachSeries(
    servicesOrder,
    function(service, next) {
      log.info('Starting ' + service.name);
      try {
        self._instantiateService(service);
      } catch(err) {
        return callback(err);
      }
      self.services[service.name].start(next);
    },
    callback
  );
};

Node.prototype.stop = function(callback) {
  log.info('Beginning shutdown');
  var self = this;
  var services = this.getServiceOrder().reverse();

  this.stopping = true;
  this.emit('stopping');

  async.eachSeries(
    services,
    function(service, next) {
      log.info('Stopping ' + service.name);
      self.services[service.name].stop(next);
    },
    callback
  );
};

module.exports = Node;
