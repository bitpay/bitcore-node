'use strict';

var Bus = require('../lib/bus');
var util = require('util');
var BaseService = require('../lib/service');

function TestService() {
  this.subscriptions = {};
  this.subscriptions['test/test'] = {};
}
util.inherits(TestService, BaseService);

TestService.prototype.subscribe = function(name, emitter) {
  emitter.emit('Subscribe');
};

TestService.prototype.unsubscribe = function(name, emitter) {
  emitter.emit('Unsubscribe');
};

TestService.prototype.getPublishEvents = function() {
  return [
    {
      name: 'test/test',
      scope: this,
      subscribe: this.subscribe.bind(this, 'test/test'),
      unsubscribe: this.unsubscribe.bind(this, 'test/test')
    }
  ];
}

describe('Bus Functionality', function() {
  var params;
  before(function() {
    params = {
      node : {
        services : [
          new TestService()
        ]
      }
    }
  });

  after(function(done) {
    done();
  });

  it('#subscribe', function(done) {
    var bus = new Bus(params);
    bus.on('Subscribe', function() {
      done();
    });
    bus.subscribe('test/test');
  });

  it('#unsubscribe', function(done) {
    var bus = new Bus(params);
    bus.on('Unsubscribe', function() {
      done();
    });
    bus.subscribe('test/test');
    bus.unsubscribe('test/test');
  });

  it('#close', function(done) {
    var bus = new Bus(params);
    bus.on('Unsubscribe', function() {
      done();
    });
    bus.close();
  });

});

