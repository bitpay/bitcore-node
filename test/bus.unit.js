'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var Bus = require('../lib/bus');

describe('Bus', function() {

  describe('#subscribe', function() {
    it('will call db and services subscribe function with the correct arguments', function() {
      var subscribeDb = sinon.spy();
      var subscribeService = sinon.spy();
      var node = {
        services: {
          db: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'dbtest',
                scope: this,
                subscribe: subscribeDb
              }
            ])
          },
          service1: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                subscribe: subscribeService,
              }
            ])
          }
        }
      };
      var bus = new Bus({node: node});
      bus.subscribe('dbtest', 'a', 'b', 'c');
      bus.subscribe('test', 'a', 'b', 'c');
      subscribeService.callCount.should.equal(1);
      subscribeDb.callCount.should.equal(1);
      subscribeDb.args[0][0].should.equal(bus);
      subscribeDb.args[0][1].should.equal('a');
      subscribeDb.args[0][2].should.equal('b');
      subscribeDb.args[0][3].should.equal('c');
      subscribeService.args[0][0].should.equal(bus);
      subscribeService.args[0][1].should.equal('a');
      subscribeService.args[0][2].should.equal('b');
      subscribeService.args[0][3].should.equal('c');
    });
  });

  describe('#unsubscribe', function() {
    it('will call db and services unsubscribe function with the correct arguments', function() {
      var unsubscribeDb = sinon.spy();
      var unsubscribeService = sinon.spy();
      var node = {
        services: {
          db: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'dbtest',
                scope: this,
                unsubscribe: unsubscribeDb
              }
            ])
          },
          service1: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                unsubscribe: unsubscribeService,
              }
            ])
          }
        }
      };
      var bus = new Bus({node: node});
      bus.unsubscribe('dbtest', 'a', 'b', 'c');
      bus.unsubscribe('test', 'a', 'b', 'c');
      unsubscribeService.callCount.should.equal(1);
      unsubscribeDb.callCount.should.equal(1);
      unsubscribeDb.args[0][0].should.equal(bus);
      unsubscribeDb.args[0][1].should.equal('a');
      unsubscribeDb.args[0][2].should.equal('b');
      unsubscribeDb.args[0][3].should.equal('c');
      unsubscribeService.args[0][0].should.equal(bus);
      unsubscribeService.args[0][1].should.equal('a');
      unsubscribeService.args[0][2].should.equal('b');
      unsubscribeService.args[0][3].should.equal('c');
    });
  });

  describe('#close', function() {
    it('will unsubscribe from all events', function() {
      var unsubscribeDb = sinon.spy();
      var unsubscribeService = sinon.spy();
      var node = {
        services: {
          db: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'dbtest',
                scope: this,
                unsubscribe: unsubscribeDb
              }
            ])
          },
          service1: {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                unsubscribe: unsubscribeService
              }
            ])
          }
        }
      };
      var bus = new Bus({node: node});
      bus.close();

      unsubscribeDb.callCount.should.equal(1);
      unsubscribeService.callCount.should.equal(1);
      unsubscribeDb.args[0].length.should.equal(1);
      unsubscribeDb.args[0][0].should.equal(bus);
      unsubscribeService.args[0].length.should.equal(1);
      unsubscribeService.args[0][0].should.equal(bus);
    });
  });

});
