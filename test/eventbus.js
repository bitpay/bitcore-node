'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');

var EventBus = require('../lib/eventbus');

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
    it('foo returns two bars', function() {
      var bus = new EventBus();
      var spy = sinon.spy();
      bus.register(FooEvent, function() {
        var b1 = new BarEvent();
        var b2 = new BarEvent();
        return [b1, b2];
      });
      bus.register(BarEvent, spy);
      bus.process(foo);
      spy.callCount.should.equal(2);
    });
  });

});
