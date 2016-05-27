'use strict';

var sinon = require('sinon');
var Service = require('../lib/service');
var BitcoreNode = require('../lib/node');
var util = require('util');
var should = require('chai').should();
var index = require('../lib');
var log = index.log;

var TestService = function(options) {
  this.node = options.node;
};
util.inherits(TestService, Service);
TestService.dependencies = [];

TestService.prototype.start = function(callback) {
  callback();
};
TestService.prototype.stop = function(callback) {
  callback();
};
TestService.prototype.close = function(callback) {
  callback();
};
TestService.prototype.getPublishEvents = function() {
  return [
    {
      name: 'test/testEvent',
      scope: this,
      subscribe: this.subscribe.bind(this, 'test/testEvent'),
      unsubscribe: this.unsubscribe.bind(this, 'test/testEvent')
    }
  ];
};

TestService.prototype.subscribe = function(name, emitter, params) {
  emitter.emit(name, params);
};

TestService.prototype.unsubscribe = function(name, emitter) {
  emitter.emit('unsubscribe');
};


describe('Bus Functionality', function() {
  var sandbox = sinon.sandbox.create();
  beforeEach(function() {
    sandbox.stub(log, 'info');
  });
  afterEach(function() {
    sandbox.restore();
  });

  it('should subscribe to testEvent', function(done) {
    var node = new BitcoreNode({
      datadir: './',
      network: 'testnet',
      port: 8888,
      services: [
        {
          name: 'testService',
          config: {},
          module: TestService
        }
      ]
    });
    node.start(function() {
      var bus = node.openBus();
      var params = 'somedata';
      bus.on('test/testEvent', function(data) {
        data.should.be.equal(params);
        done();
      });
      bus.subscribe('test/testEvent', params);
    });
  });

  it('should unsubscribe from a testEvent', function(done) {
    var node = new BitcoreNode({
      datadir: './',
      network: 'testnet',
      port: 8888,
      services: [
        {
          name: 'testService',
          config: {},
          module: TestService
        }
      ]
    });
    node.start(function() {
      var bus = node.openBus();
      var params = 'somedata';
      bus.on('unsubscribe', function() {
        done();
      });
      bus.subscribe('test/testEvent');
      bus.unsubscribe('test/testEvent');

    });

  });
});
