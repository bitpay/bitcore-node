'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var Bus = require('../lib/bus');

describe('Bus', function() {

  describe('#subscribe', function() {
    it('will call db and modules subscribe function with the correct arguments', function() {
      var subscribeDb = sinon.spy();
      var subscribeModule = sinon.spy();
      var db = {
        getPublishEvents: sinon.stub().returns([
            {
              name: 'dbtest',
              scope: this,
              subscribe: subscribeDb
            }
          ]
        ),
        modules: [
          {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                subscribe: subscribeModule,
              }
            ])
          }
        ]
      };
      var bus = new Bus({db: db});
      bus.subscribe('dbtest', 'a', 'b', 'c');
      bus.subscribe('test', 'a', 'b', 'c');
      subscribeModule.callCount.should.equal(1);
      subscribeDb.callCount.should.equal(1);
      subscribeDb.args[0][0].should.equal(bus);
      subscribeDb.args[0][1].should.equal('a');
      subscribeDb.args[0][2].should.equal('b');
      subscribeDb.args[0][3].should.equal('c');
      subscribeModule.args[0][0].should.equal(bus);
      subscribeModule.args[0][1].should.equal('a');
      subscribeModule.args[0][2].should.equal('b');
      subscribeModule.args[0][3].should.equal('c');
    });
  });

  describe('#unsubscribe', function() {
    it('will call db and modules unsubscribe function with the correct arguments', function() {
      var unsubscribeDb = sinon.spy();
      var unsubscribeModule = sinon.spy();
      var db = {
        getPublishEvents: sinon.stub().returns([
            {
              name: 'dbtest',
              scope: this,
              unsubscribe: unsubscribeDb
            }
          ]
        ),
        modules: [
          {
            getPublishEvents: sinon.stub().returns([
              {
                name: 'test',
                scope: this,
                unsubscribe: unsubscribeModule,
              }
            ])
          }
        ]
      };
      var bus = new Bus({db: db});
      bus.unsubscribe('dbtest', 'a', 'b', 'c');
      bus.unsubscribe('test', 'a', 'b', 'c');
      unsubscribeModule.callCount.should.equal(1);
      unsubscribeDb.callCount.should.equal(1);
      unsubscribeDb.args[0][0].should.equal(bus);
      unsubscribeDb.args[0][1].should.equal('a');
      unsubscribeDb.args[0][2].should.equal('b');
      unsubscribeDb.args[0][3].should.equal('c');
      unsubscribeModule.args[0][0].should.equal(bus);
      unsubscribeModule.args[0][1].should.equal('a');
      unsubscribeModule.args[0][2].should.equal('b');
      unsubscribeModule.args[0][3].should.equal('c');
    });
  });

  describe('#close', function() {
    it('will unsubscribe from all events', function() {
      var unsubscribeDb = sinon.spy();
      var unsubscribeModule = sinon.spy();
      var db = {
        getPublishEvents: sinon.stub().returns([
            {
              name: 'dbtest',
              scope: this,
              unsubscribe: unsubscribeDb
            }
          ]
        ),
        modules: [
          {
            getPublishEvents: sinon.stub().returns([
            {
              name: 'test',
              scope: this,
              unsubscribe: unsubscribeModule
            }
            ])
          }
        ]
      };

      var bus = new Bus({db: db});
      bus.close();

      unsubscribeDb.callCount.should.equal(1);
      unsubscribeModule.callCount.should.equal(1);
      unsubscribeDb.args[0].length.should.equal(1);
      unsubscribeDb.args[0][0].should.equal(bus); 
      unsubscribeModule.args[0].length.should.equal(1);
      unsubscribeModule.args[0][0].should.equal(bus);
    });
  });

});
