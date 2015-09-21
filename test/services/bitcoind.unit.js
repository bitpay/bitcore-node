'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var fs = require('fs');
var sinon = require('sinon');
var readFileSync = sinon.stub().returns(fs.readFileSync(__dirname + '/../data/bitcoin.conf'));
var BitcoinService = proxyquire('../../lib/services/bitcoind', {
  fs: {
    readFileSync: readFileSync
  }
});

describe('Bitcoin Service', function() {
  var baseConfig = {
    node: {
      datadir: 'testdir',
      network: {
        name: 'regtest'
      }
    }
  };
  describe('@constructor', function() {
    it('will create an instance', function() {
      var bitcoind = new BitcoinService(baseConfig);
      should.exist(bitcoind);
    });
    it('will create an instance without `new`', function() {
      var bitcoind = BitcoinService(baseConfig);
      should.exist(bitcoind);
    });
  });
  describe('@dependencies', function() {
    it('will have no dependencies', function() {
      BitcoinService.dependencies.should.deep.equal([]);
    });
  });
  describe('#_loadConfiguration', function() {
    it('will parse a bitcoin.conf file', function() {
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync,
          existsSync: sinon.stub().returns(true)
        },
        mkdirp: {
          sync: sinon.stub()
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._loadConfiguration({datadir: process.env.HOME + '/.bitcoin'});
      should.exist(bitcoind.configuration);
      bitcoind.configuration.should.deep.equal({
        server: 1,
        whitelist: '127.0.0.1',
        txindex: 1,
        port: 20000,
        rpcallowip: '127.0.0.1',
        rpcuser: 'bitcoin',
        rpcpassword: 'local321'
      });
    });
    it('should throw an exception if txindex isn\'t enabled in the configuration', function() {
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: sinon.stub().returns(fs.readFileSync(__dirname + '/../data/badbitcoin.conf')),
          existsSync: sinon.stub().returns(true),
        },
        mkdirp: {
          sync: sinon.stub()
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      (function() {
        bitcoind._loadConfiguration({datadir: './test'});
      }).should.throw('Txindex option');
    });
    it('should set https options if node https options are set', function() {
      var writeFileSync = function(path, config) {
        config.should.equal('whitelist=127.0.0.1\ntxindex=1\nrpcssl=1\nrpcsslprivatekeyfile=key.pem\nrpcsslcertificatechainfile=cert.pem\n');
      };
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          writeFileSync: writeFileSync,
          readFileSync: readFileSync,
          existsSync: sinon.stub().returns(false)
        },
        mkdirp: {
          sync: sinon.stub()
        }
      });
      var config = {
        node: {
          datadir: 'testdir',
          network: {
            name: 'regtest'
          },
          https: true,
          httpsOptions: {
            key: 'key.pem',
            cert: 'cert.pem'
          }
        }
      };
      var bitcoind = new TestBitcoin(config);
      bitcoind._loadConfiguration({datadir: process.env.HOME + '/.bitcoin'});
    });
    describe('reindex', function() {
      var log = require('../../lib/').log;
      var stub;
      beforeEach(function() {
        stub = sinon.stub(log, 'warn');
      });
      after(function() {
        stub.restore();
      });
      it('should warn the user if reindex is set to 1 in the bitcoin.conf file', function() {
        var readFileSync = function() {
          return "txindex=1\nreindex=1";
        };
        var testbitcoin = proxyquire('../../lib/services/bitcoind', {
          fs: {
            readFileSync: readFileSync,
            existsSync: sinon.stub().returns(true)
          },
          mkdirp: {
            sync: sinon.stub()
          },
        });
        var bitcoind = new testbitcoin(baseConfig);
        bitcoind._loadConfiguration();
        stub.callCount.should.equal(1);
      });
    });
  });
  describe('#_registerEventHandlers', function() {
    it('will emit tx with transactions from bindings', function(done) {
      var transaction = {};
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            onTipUpdate: sinon.stub(),
            startTxMon: sinon.stub().callsArgWith(0, [transaction])
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind.on('tx', function(tx) {
        tx.should.equal(transaction);
        done();
      });
      bitcoind._registerEventHandlers();
    });
    it('will emit tip from bindings', function(done) {
      var height = 1;
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            syncPercentage: function() {
              return height * 10;
            },
            onTipUpdate: function(callback) {
              if (height >= 10) {
                return callback(undefined);
              }
              setImmediate(function() {
                callback(height++);
              });
            },
            startTxMon: sinon.stub()
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      var tipCallCount = 0;
      bitcoind.on('tip', function(height) {
        should.exist(height);
        tipCallCount++;
        if (height === 9) {
          tipCallCount.should.equal(9);
          done();
        }
      });
      bitcoind._registerEventHandlers();
    });
  });
  describe('#_onReady', function(done) {
    var genesisBuffer = new Buffer('0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000', 'hex');
    it('will emit ready and set the height and genesisBuffer', function(done) {
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            onTipUpdate: sinon.stub(),
            startTxMon: sinon.stub(),
            getInfo: sinon.stub().returns({
              blocks: 101
            }),
            getBlock: sinon.stub().callsArgWith(1, null, genesisBuffer)
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._registerEventHandlers = sinon.stub();
      var result = {};
      var readyCallCount = 0;
      bitcoind.on('ready', function() {
        readyCallCount++;
      });
      bitcoind._onReady(result, function(err) {
        if (err) {
          throw err;
        }
        bitcoind._registerEventHandlers.callCount.should.equal(1);
        readyCallCount.should.equal(1);
        bitcoind.genesisBuffer.should.equal(genesisBuffer);
        bitcoind.height.should.equal(101);
        done();
      });
    });
  });
  describe('#start', function() {
    it('call bindings start with the correct arguments', function(done) {
      var startCallCount = 0;
      var start = function(obj, cb) {
        startCallCount++;
        obj.datadir.should.equal('testdir');
        obj.network.should.equal('regtest');
        cb();
      };
      var onBlocksReady = sinon.stub().callsArg(0);
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            start: start,
            onBlocksReady: onBlocksReady
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._loadConfiguration = sinon.stub();
      bitcoind._onReady = sinon.stub().callsArg(1);
      bitcoind.start(function(err) {
        should.not.exist(err);
        bitcoind._loadConfiguration.callCount.should.equal(1);
        startCallCount.should.equal(1);
        onBlocksReady.callCount.should.equal(1);
        bitcoind._onReady.callCount.should.equal(1);
        done();
      });
    });
    it('will give an error from bindings.start', function(done) {
      var start = sinon.stub().callsArgWith(1, new Error('test'));
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            start: start
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._loadConfiguration = sinon.stub();
      bitcoind.start(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });
    it('will give an error from bindings.onBlocksReady', function(done) {
      var start = sinon.stub().callsArgWith(1, null);
      var onBlocksReady = sinon.stub().callsArgWith(0, new Error('test'));
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            start: start,
            onBlocksReady: onBlocksReady
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._onReady = sinon.stub().callsArg(1);
      bitcoind._loadConfiguration = sinon.stub();
      bitcoind.start(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });
    describe('reindex', function() {
      var log = require('../../lib/').log;
      var info;
      beforeEach(function() {
        info = sinon.stub(log, 'info');
      });
      afterEach(function() {
        info.restore();
      });
      it('will wait for a reindex to complete before calling the callback.', function(done) {
        var start = sinon.stub().callsArgWith(1, null);
        var onBlocksReady = sinon.stub().callsArg(0);
        var percentage = 98;
        var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
          fs: {
            readFileSync: readFileSync
          },
          bindings: function(name) {
            return {
              start: start,
              onBlocksReady: onBlocksReady,
              syncPercentage: function() {
                return percentage;
              }
            };
          }
        });
        var bitcoind = new TestBitcoin(baseConfig);
        bitcoind._reindex = true;
        bitcoind._reindexWait = 1;
        bitcoind._onReady = sinon.stub().callsArg(1);
        bitcoind._loadConfiguration = sinon.stub();
        bitcoind.start(function() {
          info.callCount.should.be.within(2,3);
          bitcoind._reindex.should.be.false;
          done();
        });
        setTimeout(function() {
          percentage = 100;
        }, 2);
      });
    });
  });
  describe('#stop', function() {
    it('will call bindings stop', function() {
      var stop = sinon.stub().callsArgWith(0, null, 'status');
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            stop: stop
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind.stop(function(err, status) {
        stop.callCount.should.equal(1);
        should.not.exist(err);
      });
    });
    it('will give an error from bindings stop', function() {
      var stop = sinon.stub().callsArgWith(0, new Error('test'));
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync
        },
        bindings: function(name) {
          name.should.equal('bitcoind.node');
          return {
            stop: stop
          };
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind.stop(function(err) {
        stop.callCount.should.equal(1);
        should.exist(err);
        err.message.should.equal('test');
      });
    });
  });
  describe('proxy methods', function() {

    var proxyMethods = [
      ['isSynced', 0],
      ['syncPercentage', 0],
      ['getBlock', 2],
      ['isSpent', 2],
      ['getBlockIndex', 1],
      ['isMainChain', 1],
      ['estimateFee', 1],
      ['sendTransaction', 2],
      ['getTransaction', 3],
      ['getTransactionWithBlockInfo', 3],
      ['getMempoolTransactions', 0],
      ['addMempoolUncheckedTransaction', 1],
      ['getTxOutSetInfo', 0],
      ['getBestBlockHash', 0],
      ['getNextBlockHash', 1],
      ['getInfo', 0]
    ];

    proxyMethods.forEach(function(x) {
      it('pass ' + x[1] + ' argument(s) to ' + x[0], function() {

        var stub = sinon.stub();
        var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
          fs: {
            readFileSync: readFileSync
          },
          bindings: function(name) {
            name.should.equal('bitcoind.node');
            var methods = {};
            methods[x[0]] = stub;
            return methods;
          }
        });

        var bitcoind = new TestBitcoin(baseConfig);
        var args = [];
        for (var i = 0; i < x[1]; i++) {
          args.push(i);
        }

        bitcoind[x[0]].apply(bitcoind, args);
        stub.callCount.should.equal(1);
        stub.args[0].length.should.equal(x[1]);
      });
    });
  });

});
