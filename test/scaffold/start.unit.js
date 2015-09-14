'use strict';

var should = require('chai').should();
var EventEmitter = require('events').EventEmitter;
var path = require('path');
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var start = require('../../lib/scaffold/start');

describe('#start', function() {
  describe('#setupServices', function() {
    var cwd = process.cwd();
    var setupServices = proxyquire('../../lib/scaffold/start', {}).setupServices;
    it('will require an internal module', function() {
      function InternalService() {}
      InternalService.dependencies = [];
      InternalService.prototype.start = sinon.stub();
      InternalService.prototype.stop = sinon.stub();
      var expectedPath = path.resolve(__dirname, '../../lib/services/internal');
      var testRequire = function(p) {
        p.should.equal(expectedPath);
        return InternalService;
      };
      var config = {
        services: ['internal'],
        servicesConfig: {
          internal: {
            param: 'value'
          }
        }
      };
      var services = setupServices(testRequire, cwd, config);
      services[0].name.should.equal('internal');
      services[0].config.should.deep.equal({param: 'value'});
      services[0].module.should.equal(InternalService);
    });
    it('will require a local module', function() {
      function LocalService() {}
      LocalService.dependencies = [];
      LocalService.prototype.start = sinon.stub();
      LocalService.prototype.stop = sinon.stub();
      var notfoundPath = path.resolve(__dirname, '../../lib/services/local');
      var testRequire = function(p) {
        if (p === notfoundPath) {
          throw new Error();
        } else if (p === 'local') {
          return LocalService;
        } else if (p === 'local/package.json') {
          return {
            name: 'local'
          };
        }
      };
      var config = {
        services: ['local']
      };
      var services = setupServices(testRequire, cwd, config);
      services[0].name.should.equal('local');
      services[0].module.should.equal(LocalService);
    });
    it('will require a local module with "bitcoreNode" in package.json', function() {
      function LocalService() {}
      LocalService.dependencies = [];
      LocalService.prototype.start = sinon.stub();
      LocalService.prototype.stop = sinon.stub();
      var notfoundPath = path.resolve(__dirname, '../../lib/services/local');
      var testRequire = function(p) {
        if (p === notfoundPath) {
          throw new Error();
        } else if (p === 'local/package.json') {
          return {
            name: 'local',
            bitcoreNode: 'lib/bitcoreNode.js'
          };
        } else if (p === 'local/lib/bitcoreNode.js') {
          return LocalService;
        }
      };
      var config = {
        services: ['local']
      };
      var services = setupServices(testRequire, cwd, config);
      services[0].name.should.equal('local');
      services[0].module.should.equal(LocalService);
    });
    it('will throw error if module is incompatible', function() {
      var internal = {};
      var testRequire = function() {
        return internal;
      };
      var config = {
        services: ['bitcoind']
      };
      (function() {
        setupServices(testRequire, cwd, config);
      }).should.throw('Could not load service');
    });
  });
  describe('#registerSyncHandlers', function() {
    it('will log the sync status at an interval', function(done) {
      var log = {
        info: sinon.stub()
      };
      var registerSyncHandlers = proxyquire('../../lib/scaffold/start', {
        '../': {
          log: log
        }
      }).registerSyncHandlers;
      var node = new EventEmitter();
      node.services = {
        db: new EventEmitter()
      };
      node.services.db.tip = {
        hash: 'hash',
        __height: 10
      };
      registerSyncHandlers(node, 10);
      node.emit('ready');
      node.services.db.emit('addblock');
      setTimeout(function() {
        node.emit('synced');
        log.info.callCount.should.be.within(3, 4);
        done();
      }, 35);
    });
  });
  describe('#cleanShutdown', function() {
    it('will call node stop and process exit', function() {
      var log = {
        info: sinon.stub(),
        error: sinon.stub()
      };
      var cleanShutdown = proxyquire('../../lib/scaffold/start', {
        '../': {
          log: log
        }
      }).cleanShutdown;
      var node = {
        stop: sinon.stub().callsArg(0)
      };
      var _process = {
        exit: sinon.stub()
      };
      cleanShutdown(_process, node);
      setImmediate(function() {
        node.stop.callCount.should.equal(1);
        _process.exit.callCount.should.equal(1);
        _process.exit.args[0][0].should.equal(0);
      });
    });
    it('will log error during shutdown and exit with status 1', function() {
      var log = {
        info: sinon.stub(),
        error: sinon.stub()
      };
      var cleanShutdown = proxyquire('../../lib/scaffold/start', {
        '../': {
          log: log
        }
      }).cleanShutdown;
      var node = {
        stop: sinon.stub().callsArgWith(0, new Error('test'))
      };
      var _process = {
        exit: sinon.stub()
      };
      cleanShutdown(_process, node);
      setImmediate(function() {
        node.stop.callCount.should.equal(1);
        log.error.callCount.should.equal(1);
        _process.exit.callCount.should.equal(1);
        _process.exit.args[0][0].should.equal(1);
      });
    });
  });
  describe('#registerExitHandlers', function() {
    var log = {
      info: sinon.stub(),
      error: sinon.stub()
    };
    var registerExitHandlers = proxyquire('../../lib/scaffold/start', {
      '../': {
        log: log
      }
    }).registerExitHandlers;
    it('log, stop and exit with an `uncaughtException`', function(done) {
      var proc = new EventEmitter();
      proc.exit = sinon.stub();
      var node = {
        stop: sinon.stub().callsArg(0)
      };
      registerExitHandlers(proc, node);
      proc.emit('uncaughtException', new Error('test'));
      setImmediate(function() {
        node.stop.callCount.should.equal(1);
        proc.exit.callCount.should.equal(1);
        done();
      });
    });
    it('stop and exit on `SIGINT`', function(done) {
      var proc = new EventEmitter();
      proc.exit = sinon.stub();
      var node = {
        stop: sinon.stub().callsArg(0)
      };
      registerExitHandlers(proc, node);
      proc.emit('SIGINT');
      setImmediate(function() {
        node.stop.callCount.should.equal(1);
        proc.exit.callCount.should.equal(1);
        done();
      });
    });
  });
  describe('#spawnChildProcess', function() {

    it('should build the appropriate arguments to spawn a child process', function() {
      var child = {
        unref: function() {}
      };
      var _process = {
        exit: function() {},
        env: {
          __bitcore_node: false
        },
        argv: [
          'node',
          'bitcore-node'
        ],
        cwd: function(){return ''},
        pid: 999,
        execPath: '/tmp'
      };
      var fd = {};
      var spawn = sinon.stub().returns(child);
      var openSync = sinon.stub().returns(fd);
      var spawnChildProcess = proxyquire('../../lib/scaffold/start', {
        fs: {
          openSync: openSync
        },
        child_process: {
          spawn: spawn
        }
      }).spawnChildProcess;

      spawnChildProcess('/tmp', _process);

      spawn.callCount.should.equal(1);
      spawn.args[0][0].should.equal(_process.execPath);
      var expected = [].concat(_process.argv);
      expected.shift();
      spawn.args[0][1].should.deep.equal(expected);
      var cp_opt = {
        stdio: ['ignore', fd, fd],
        env: _process.env,
        cwd: '',
        detached: true
      };
      spawn.args[0][2].should.deep.equal(cp_opt);
      openSync.callCount.should.equal(1);
      openSync.args[0][0].should.equal('/tmp/bitcore-node.log');
      openSync.args[0][1].should.equal('a+');
    });
    it('should not spawn a new child process if there is already a daemon running', function() {
      var _process = {
        exit: function() {},
        env: {
          __bitcore_node: true
        },
        argv: [
          'node',
          'bitcore-node'
        ],
        cwd: 'cwd',
        pid: 999,
        execPath: '/tmp'
      };
      var spawnChildProcess = proxyquire('../../lib/scaffold/start', {}).spawnChildProcess;
      spawnChildProcess('/tmp', _process).should.equal(999);
    });
  });
  describe('daemon', function() {
    var sandbox;
    var spawn;
    var setup;
    var registerSync;
    var registerExit;
    var start = require('../../lib/scaffold/start');
    var options = {
      config: {
        datadir: '/tmp',
        daemon: true
      }
    }
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      spawn = sandbox.stub(start, 'spawnChildProcess', function() {});
      setup = sandbox.stub(start, 'setupServices', function() {});
      registerSync = sandbox.stub(start, 'registerSyncHandlers', function() {});
      registerExit = sandbox.stub(start, 'registerExitHandlers', function() {});
    });
    afterEach(function() {
      sandbox.restore();
    });
    it('call spawnChildProcess if there is a config option to do so', function() {
      start(options);
      registerSync.callCount.should.equal(1);
      registerExit.callCount.should.equal(1);
      spawn.callCount.should.equal(1);
    });
    it('not call spawnChildProcess if there is not an option to do so', function() {
      options.config.daemon = false;
      start(options);
      registerSync.callCount.should.equal(1);
      registerExit.callCount.should.equal(1);
      spawn.callCount.should.equal(0);
    });
  });
  describe('#registerExitHandlers', function() {
    var stub;
    var registerExitHandlers = require('../../lib/scaffold/start').registerExitHandlers;

    before(function() {
      stub = sinon.stub(process, 'on');
    });

    after(function() {
      stub.restore();
    });

    it('should setup two listeners on process when registering exit handlers', function() {
      registerExitHandlers(process, {});
      stub.callCount.should.equal(2);
    });

    describe('#exitHandler', function() {
      var sandbox;
      var cleanShutdown;
      var exitHandler;
      var logStub;

      before(function() {
        sandbox = sinon.sandbox.create();
        var start = require('../../lib/scaffold/start');
        var log = require('../../lib').log;
        logStub = sandbox.stub(log, 'error');
        cleanShutdown = sandbox.stub(start, 'cleanShutdown', function() {});
        exitHandler = require('../../lib/scaffold/start').exitHandler;
      });

      after(function() {
        sandbox.restore();
      });

      it('should replace the listener for SIGINT after the first SIGINT is handled', function() {
        var  options = { sigint: true };
        var node = {};
        exitHandler(options, process, node);
        cleanShutdown.callCount.should.equal(1);
        exitHandler(options, process, node);
        cleanShutdown.callCount.should.equal(1);
      });

      it('should log all errors and stops the services nonetheless', function() {
        var  options = { sigint: true };
        var stop = sinon.stub();
        var node = {
          stop: stop
        };
        exitHandler(options, process, node, new Error('some error'));
        logStub.callCount.should.equal(2);
        stop.callCount.should.equal(1);
      });

    });
  });
});
