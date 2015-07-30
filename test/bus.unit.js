'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var Bus = require('../lib/bus');

describe('Bus', function() {

  describe('#subscribe', function() {
    it('will call modules subscribe function with the correct arguments', function() {
      var subscribe = sinon.spy();
      var db = {
        modules: [
          {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                subscribe: subscribe,
              }
            ])
          }
        ]
      };
      var bus = new Bus({db: db});
      bus.subscribe('test', 'a', 'b', 'c');
      subscribe.callCount.should.equal(1);
      subscribe.args[0][0].should.equal(bus);
      subscribe.args[0][1].should.equal('a');
      subscribe.args[0][2].should.equal('b');
      subscribe.args[0][3].should.equal('c');
    });
  });

  describe('#unsubscribe', function() {
    it('will call modules unsubscribe function with the correct arguments', function() {
      var unsubscribe = sinon.spy();
      var db = {
        modules: [
          {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                unsubscribe: unsubscribe
              }
            ])
          }
        ]
      };
      var bus = new Bus({db: db});
      bus.unsubscribe('test', 'a', 'b', 'c');
      unsubscribe.callCount.should.equal(1);
      unsubscribe.args[0][0].should.equal(bus);
      unsubscribe.args[0][1].should.equal('a');
      unsubscribe.args[0][2].should.equal('b');
      unsubscribe.args[0][3].should.equal('c');
    });
  });

});
