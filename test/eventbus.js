'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');

var Promise = require('bluebird');
var EventBus = require('../lib/eventbus');
Promise.longStackTraces();

describe('EventBus', function() {

  it('instantiate', function() {
    var bus = new EventBus();
    should.exist(bus);
  });

  describe('process', function() {
    function FooEvent() {}

    function BarEvent() {}
    var foo = new FooEvent();
    var bar = new BarEvent();
    foo.x = 2;
    bar.y = 3;

    it('no handlers registered', function() {
      var bus = new EventBus();
      bus.process.bind(bus, foo).should.not.throw();
    });
    it('simple handler gets called', function(cb) {
      var bus = new EventBus();
      bus.register(FooEvent, function(e) {
        e.x.should.equal(foo.x);
        cb();
      });
      bus.process(foo);
    });
    it('other event does not get called', function() {
      var bus = new EventBus();
      var spy = sinon.spy();
      bus.register(FooEvent, spy);
      bus.process(bar);
      spy.callCount.should.equal(0);
    });
    it('foo returns bar', function(cb) {
      var bus = new EventBus();
      bus.register(FooEvent, function(e) {
        var b = new BarEvent();
        b.y = e.x;
        return [b];
      });
      bus.register(BarEvent, function(e) {
        e.y.should.equal(foo.x);
        cb();
      });
      bus.process(foo);
    });
    var b1 = new BarEvent();
    b1.x = 42;
    var b2 = new BarEvent();
    b2.x = 69;
    it('foo returns two bars', function() {
      var bus = new EventBus();
      var spy = sinon.spy();
      bus.register(FooEvent, function() {
        return [b1, b2];
      });
      bus.register(BarEvent, spy);
      bus.process(foo);
      spy.callCount.should.equal(2);
    });
    it('foo returns two bars and emits external events', function(cb) {
      var bus = new EventBus();
      var spy = sinon.spy(bus, 'emit');
      bus.register(FooEvent, function() {
        return [b1, b2];
      });
      bus.process(foo)
        .then(function() {
          spy.calledWith('BarEvent', b1).should.equal(true);
          spy.calledWith('BarEvent', b2).should.equal(true);
        })
        .then(cb);
    });
    it('foo returns two async bars', function(cb) {
      var bus = new EventBus();
      var spy = sinon.spy();
      bus.register(FooEvent, function() {
        return Promise.resolve([b1, b2]).delay(1);
      });
      bus.register(BarEvent, spy);
      bus.process(foo)
        .then(function() {
          spy.callCount.should.equal(2);
        })
        .then(cb);
    });
    it('events are not externalized when async processing fails', function(cb) {
      var bus = new EventBus();
      var spy = sinon.spy(bus, 'emit');
      var err = new Error();
      bus.register(FooEvent, function() {
        return Promise.resolve([b1, b2]).delay(1);
      });
      bus.register(BarEvent, function(e) {
        if (e.x === b1.x) {
          throw err;
        }
      });
      bus.process(foo)
        .catch(function(reason) {
          reason.should.equal(err);
          spy.callCount.should.equal(0);
          cb();
        });
    });
  });

});
