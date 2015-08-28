'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var WebService = require('../lib/web');
var EventEmitter = require('events').EventEmitter;

describe('WebService', function() {
  var defaultNode = new EventEmitter();

  describe('#start', function() {
    it('should call the callback with no error', function(done) {
      var web = new WebService({node: defaultNode});
      web.start(function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('should close the server if it exists', function(done) {
      var web = new WebService({node: defaultNode});
      web.server = {
        close: sinon.spy()
      };

      web.stop(function(err) {
        should.not.exist(err);
        web.server.close.callCount.should.equal(1);
        done();
      });
    });
  });

  describe('#setupRoutes', function() {
    it('should call setupRoutes on each module', function() {
      var node = {
        on: sinon.spy(),
        modules: {
          one: {
            setupRoutes: sinon.spy()
          },
          two: {
            setupRoutes: sinon.spy()
          }
        }
      };

      var web = new WebService({node: node});

      web.setupRoutes();
      node.modules.one.setupRoutes.callCount.should.equal(1);
      node.modules.two.setupRoutes.callCount.should.equal(1);
    });
  });

  describe('#createMethodsMap', function() {
    it('should create the methodsMap correctly', function(done) {
      var Module1 = function() {};
      Module1.prototype.getAPIMethods = function() {
        return [
          ['one', this, this.one, 1],
          ['two', this, this.two, 2]
        ];
      };
      Module1.prototype.one = function(param1, callback) {
        callback(null, param1);
      };
      Module1.prototype.two = function(param1, param2, callback) {
        callback(null, param1 + param2);
      };

      var module1 = new Module1();

      var node = {
        on: sinon.spy(),
        getAllAPIMethods: sinon.stub().returns(module1.getAPIMethods())
      };

      var web = new WebService({node: node});
      web.createMethodsMap();

      Object.keys(web.methodsMap).length.should.equal(2);
      web.methodsMap.one.args.should.equal(1);
      web.methodsMap.two.args.should.equal(2);
      web.methodsMap.one.fn(1, function(err, result) {
        should.not.exist(err);
        result.should.equal(1);

        web.methodsMap.two.fn(1, 2, function(err, result) {
          should.not.exist(err);
          result.should.equal(3);
          done();
        });
      });
    });
  });

  describe('#socketHandler', function() {
    var bus = new EventEmitter();

    var Module1 = function() {};
    Module1.prototype.getPublishEvents = function() {
      return [
        {
          name: 'event1'
        }
      ];
    };

    var module1 = new Module1();
    var node = {
      on: sinon.spy(),
      openBus: sinon.stub().returns(bus),
      getAllPublishEvents: sinon.stub().returns(module1.getPublishEvents())
    };

    var web;
    var socket;

    it('on message should call socketMessageHandler', function(done) {
      web = new WebService({node: node});
      web.socketMessageHandler = function(param1) {
        param1.should.equal('data');
        done();
      };
      socket = new EventEmitter();
      web.socketHandler(socket);
      socket.emit('message', 'data');
    });

    it('on subscribe should call bus.subscribe', function(done) {
      bus.subscribe = function(param1) {
        param1.should.equal('data');
        done();
      };

      socket.emit('subscribe', 'data');
    });

    it('on unsubscribe should call bus.unsubscribe', function(done) {
      bus.unsubscribe = function(param1) {
        param1.should.equal('data');
        done();
      };

      socket.emit('unsubscribe', 'data');
    });

    it('publish events from bus should be emitted from socket', function(done) {
      socket.once('event1', function(param1, param2) {
        param1.should.equal('param1');
        param2.should.equal('param2');
        done();
      });
      socket.connected = true;
      bus.emit('event1', 'param1', 'param2');
    });

    it('on disconnect should close bus', function(done) {
      bus.close = function() {
        done();
      };

      socket.emit('disconnect');
    });
  });

  describe('#socketMessageHandler', function() {
    var node = {
      on: sinon.spy()
    };

    var web = new WebService({node: node});
    web.methodsMap = {
      one: {
        fn: function(param1, param2, callback) {
          var result = param1 + param2;
          if(result > 0) {
            return callback(null, result);
          } else {
            return callback(new Error('error'));
          }
        },
        args: 2
      }
    };

    it('should give a Method Not Found error if method does not exist', function(done) {
      var message = {
        method: 'two',
        params: [1, 2]
      }
      web.socketMessageHandler(message, function(response) {
        should.exist(response.error);
        response.error.message.should.equal('Method Not Found');
        done();
      });
    });

    it('should call the method and return the result', function(done) {
      var message = {
        method: 'one',
        params: [1, 2]
      };
      web.socketMessageHandler(message, function(response) {
        should.not.exist(response.error);
        response.result.should.equal(3);
        done();
      });
    });

    it('should give an error if there is a param count mismatch', function(done) {
      var message = {
        method: 'one',
        params: [1]
      };
      web.socketMessageHandler(message, function(response) {
        should.exist(response.error);
        response.error.message.should.equal('Expected 2 parameter(s)');
        done();
      });
    });

    it('should give an error if the method gave an error', function(done) {
      var message = {
        method: 'one',
        params: [-1, -2]
      };
      web.socketMessageHandler(message, function(response) {
        should.exist(response.error);
        response.error.message.should.equal('Error: error');
        done();
      });
    });
  });

});