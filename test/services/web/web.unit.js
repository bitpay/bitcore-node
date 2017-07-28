'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var EventEmitter = require('events').EventEmitter;
var proxyquire = require('proxyquire');

var index = require('../../../lib');
var log = index.log;

var httpStub = {
  createServer: sinon.spy()
};
var httpsStub = {
  createServer: sinon.spy()
};
var fsStub = {
  readFileSync: function(arg1) {
    return arg1 + '-buffer';
  }
};

var fakeSocketListener = new EventEmitter();
var fakeSocket = new EventEmitter();

fakeSocket.on('test/event1', function(data) {
  data.should.equal('testdata');
});

fakeSocketListener.emit('connection', fakeSocket);
fakeSocket.emit('subscribe', 'test/event1');

var WebService = proxyquire('../../../lib/services/web', {http: httpStub, https: httpsStub, fs: fsStub});

describe('WebService', function() {
  var defaultNode = new EventEmitter();

  describe('@constructor', function() {
    it('will set socket rpc settings', function() {
      var web = new WebService({node: defaultNode, enableSocketRPC: false});
      web.enableSocketRPC.should.equal(false);

      var web2 = new WebService({node: defaultNode, enableSocketRPC: true});
      web2.enableSocketRPC.should.equal(true);

      var web3 = new WebService({node: defaultNode});
      web3.enableSocketRPC.should.equal(WebService.DEFAULT_SOCKET_RPC);
    });
    it('will set configuration options for max payload', function() {
      var web = new WebService({node: defaultNode, jsonRequestLimit: '200kb'});
      web.jsonRequestLimit.should.equal('200kb');
    });
  });

  describe('#start', function() {
    beforeEach(function() {
      httpStub.createServer.reset();
      httpsStub.createServer.reset();
    });
    it('should create an http server if no options are specified and node is not configured for https', function(done) {
      var web = new WebService({node: defaultNode});
      web.deriveHttpsOptions = sinon.spy();
      web.start(function(err) {
        should.not.exist(err);
        httpStub.createServer.called.should.equal(true);
        done();
      });
    });

    it('should create an https server if no options are specified and node is configured for https', function(done) {
      var node = new EventEmitter();
      node.https = true;

      var web = new WebService({node: node});
      web.transformHttpsOptions = sinon.spy();
      web.start(function(err) {
        should.not.exist(err);
        httpsStub.createServer.called.should.equal(true);
        done();
      });
    });
    it('should pass json request limit to json body parser', function(done) {
      var node = new EventEmitter();
      var jsonStub = sinon.stub();
      var TestWebService = proxyquire('../../../lib/services/web', {
        http: {
          createServer: sinon.stub()
        },
        https: {
          createServer: sinon.stub()
        },
        fs: fsStub,
        express: sinon.stub().returns({
          use: sinon.stub()
        }),
        'body-parser': {
          json: jsonStub
        },
        'socket.io': {
          listen: sinon.stub().returns({
            on: sinon.stub()
          })
        }
      });
      var web = new TestWebService({node: node});
      web.start(function(err) {
        if (err) {
          return done(err);
        }
        jsonStub.callCount.should.equal(1);
        jsonStub.args[0][0].limit.should.equal('100kb');
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

  describe('#setupAllRoutes', function() {
    it('should call setupRoutes on each module', function() {
      var node = {
        on: sinon.spy(),
        services: {
          one: {
            setupRoutes: sinon.spy(),
            getRoutePrefix: sinon.stub().returns('one')
          },
          two: {
            setupRoutes: sinon.spy(),
            getRoutePrefix: sinon.stub().returns('two')
          }
        }
      };

      var web = new WebService({node: node});
      web.app = {
        use: sinon.spy()
      };

      web.setupAllRoutes();
      node.services.one.setupRoutes.callCount.should.equal(1);
      should.exist(node.services.one.setupRoutes.args[0][0].engine);
      should.exist(node.services.one.setupRoutes.args[0][0].get);
      should.exist(node.services.one.setupRoutes.args[0][0].post);
      should.exist(node.services.one.setupRoutes.args[0][0].set);
      node.services.two.setupRoutes.callCount.should.equal(1);
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

  describe('#getEventNames', function() {
    it('should get event names', function() {
      var Module1 = function() {};
      Module1.prototype.getPublishEvents = function() {
        return [
          {
            name: 'event1',
            extraEvents: ['event2']
          }
        ];
      };

      var module1 = new Module1();
      var node = {
        on: sinon.spy(),
        getAllPublishEvents: sinon.stub().returns(module1.getPublishEvents())
      };

      var web = new WebService({node: node});
      var events = web.getEventNames();

      events.should.deep.equal(['event1', 'event2']);
    });

    it('should throw an error if there is a duplicate event', function() {
      var Module1 = function() {};
      Module1.prototype.getPublishEvents = function() {
        return [
          {
            name: 'event1',
            extraEvents: ['event1']
          }
        ];
      };

      var module1 = new Module1();
      var node = {
        on: sinon.spy(),
        getAllPublishEvents: sinon.stub().returns(module1.getPublishEvents())
      };

      var web = new WebService({node: node});
      (function() {
        var events = web.getEventNames();
      }).should.throw('Duplicate event event1');
    });
  });

  describe('#_getRemoteAddress', function() {
    it('will get remote address from cloudflare header', function() {
      var web = new WebService({node: defaultNode});
      var socket = {};
      socket.conn = {};
      socket.client = {};
      socket.client.request = {};
      socket.client.request.headers = {
        'cf-connecting-ip': '127.0.0.1'
      };
      var remoteAddress = web._getRemoteAddress(socket);
      remoteAddress.should.equal('127.0.0.1');
    });
    it('will get remote address from connection', function() {
      var web = new WebService({node: defaultNode});
      var socket = {};
      socket.conn = {};
      socket.conn.remoteAddress = '127.0.0.1';
      socket.client = {};
      socket.client.request = {};
      socket.client.request.headers = {};
      var remoteAddress = web._getRemoteAddress(socket);
      remoteAddress.should.equal('127.0.0.1');
    });
  });

  describe('#socketHandler', function() {
    var sandbox = sinon.sandbox.create();
    beforeEach(function() {
      sandbox.stub(log, 'info');
    });
    afterEach(function() {
      sandbox.restore();
    });

    var bus = new EventEmitter();
    bus.remoteAddress = '127.0.0.1';

    var Module1 = function() {};
    Module1.prototype.getPublishEvents = function() {
      return [
        {
          name: 'event1',
          extraEvents: ['event2']
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
      web.eventNames = web.getEventNames();
      web.socketMessageHandler = function(param1) {
        param1.should.equal('data');
        done();
      };
      socket = new EventEmitter();
      socket.conn = {};
      socket.conn.remoteAddress = '127.0.0.1';
      socket.client = {};
      socket.client.request = {};
      socket.client.request.headers = {};
      web.socketHandler(socket);
      socket.emit('message', 'data');
    });

    it('on message should NOT call socketMessageHandler if not enabled', function(done) {
      web = new WebService({node: node, enableSocketRPC: false});
      web.eventNames = web.getEventNames();
      web.socketMessageHandler = sinon.stub();
      socket = new EventEmitter();
      socket.conn = {};
      socket.conn.remoteAddress = '127.0.0.1';
      socket.client = {};
      socket.client.request = {};
      socket.client.request.headers = {};
      web.socketHandler(socket);
      socket.on('message', function() {
        web.socketMessageHandler.callCount.should.equal(0);
        done();
      });
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
      socket.once('event2', function(param1, param2) {
        param1.should.equal('param1');
        param2.should.equal('param2');
        done();
      });
      socket.connected = true;
      bus.emit('event2', 'param1', 'param2');
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
      };
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

  describe('#deriveHttpsOptions', function() {
    it('should read key and cert from files specified', function() {
      var web = new WebService({
        node: defaultNode,
        https: true,
        httpsOptions: {
          key: 'key',
          cert: 'cert'
        }
      });

      web.transformHttpsOptions();
      web.httpsOptions.key.should.equal('key-buffer');
      web.httpsOptions.cert.should.equal('cert-buffer');
    });
    it('should throw an error if https is specified but key or cert is not specified', function() {
      var web = new WebService({
        node: defaultNode,
        https: true,
        httpsOptions: {
          key: 'key'
        }
      });

      (function() {
        web.transformHttpsOptions();
      }).should.throw('Missing https options');
    });
  });

});
