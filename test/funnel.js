'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');

var Funnel = require('../lib/funnel');

describe('Funnel', function() {

  it('instantiate', function() {
    var f = new Funnel();
    should.exist(f);
  });

  describe('process', function() {
    function FooEvent() {}
    function BarEvent() {}
    var foo = new FooEvent();
    var bar = new BarEvent();
    foo.x = 2;
    bar.y = 3;

    it('no handlers registered', function() {
      var f = new Funnel();
      f.process.bind(f, foo).should.not.throw();
    });
    it('simple handler gets called', function(cb) {
      var f = new Funnel();
      f.register(FooEvent, function(e) {
        e.x.should.equal(foo.x);
        cb();
      });
      f.process(foo);
    });
    it('other event does not get called', function() {
      var f = new Funnel();
      var spy = sinon.spy();
      f.register(FooEvent, spy);
      f.process(bar);
      spy.callCount.should.equal(0);
    });
    it('foo returns bar', function(cb) {
      var f = new Funnel();
      f.register(FooEvent, function(e) {
        var b = new BarEvent();
        b.y = e.x;
        return [b];
      });
      f.register(BarEvent, function(e) {
        e.y.should.equal(foo.x);
        cb();
      });
      f.process(foo);
    });
    it('foo returns two bars', function() {
      var f = new Funnel();
      var spy = sinon.spy();
      f.register(FooEvent, function() {
        var b1 = new BarEvent();
        var b2 = new BarEvent();
        return [b1, b2];
      });
      f.register(BarEvent, spy);
      f.process(foo);
      spy.callCount.should.equal(2);
    });
  });

});
