'use strict';

var path = require('path');
var EventEmitter = require('events').EventEmitter;
var should = require('chai').should();
var crypto = require('crypto');
var bitcore = require('bitcore-lib');
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var fs = require('fs');
var sinon = require('sinon');

var index = require('../../lib');
var log = index.log;
var errors = index.errors;

var Transaction = require('../../lib/transaction');
var readFileSync = sinon.stub().returns(fs.readFileSync(path.resolve(__dirname, '../data/bitcoin.conf')));
var BitcoinService = proxyquire('../../lib/services/bitcoind', {
  fs: {
    readFileSync: readFileSync
  }
});
var defaultBitcoinConf = fs.readFileSync(path.resolve(__dirname, '../data/default.bitcoin.conf'), 'utf8');

describe('Bitcoin Service', function() {
    var txhex = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000';

  var baseConfig = {
    node: {
      network: bitcore.Networks.testnet
    },
    spawn: {
      datadir: 'testdir',
      exec: 'testpath'
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
    it('will init caches', function() {
      var bitcoind = new BitcoinService(baseConfig);
      should.exist(bitcoind.utxosCache);
      should.exist(bitcoind.txidsCache);
      should.exist(bitcoind.balanceCache);
      should.exist(bitcoind.summaryCache);
      should.exist(bitcoind.transactionInfoCache);

      should.exist(bitcoind.transactionCache);
      should.exist(bitcoind.rawTransactionCache);
      should.exist(bitcoind.blockCache);
      should.exist(bitcoind.rawBlockCache);
      should.exist(bitcoind.blockHeaderCache);
      should.exist(bitcoind.zmqKnownTransactions);
      should.exist(bitcoind.zmqKnownBlocks);
      should.exist(bitcoind.lastTip);
      should.exist(bitcoind.lastTipTimeout);
    });
    it('will init clients', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.should.deep.equal([]);
      bitcoind.nodesIndex.should.equal(0);
      bitcoind.nodes.push({client: sinon.stub()});
      should.exist(bitcoind.client);
    });
    it('will set subscriptions', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.subscriptions.should.deep.equal({
        rawtransaction: [],
        hashblock: []
      });
    });
  });

  describe('@dependencies', function() {
    it('will have no dependencies', function() {
      BitcoinService.dependencies.should.deep.equal([]);
    });
  });

  describe('#getAPIMethods', function() {
    it('will return spec', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var methods = bitcoind.getAPIMethods();
      should.exist(methods);
      methods.length.should.equal(20);
    });
  });

  describe('#getPublishEvents', function() {
    it('will return spec', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var events = bitcoind.getPublishEvents();
      should.exist(events);
      events.length.should.equal(2);
      events[0].name.should.equal('bitcoind/rawtransaction');
      events[0].scope.should.equal(bitcoind);
      events[0].subscribe.should.be.a('function');
      events[0].unsubscribe.should.be.a('function');
      events[1].name.should.equal('bitcoind/hashblock');
      events[1].scope.should.equal(bitcoind);
      events[1].subscribe.should.be.a('function');
      events[1].unsubscribe.should.be.a('function');
    });
    it('will call subscribe/unsubscribe with correct args', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.subscribe = sinon.stub();
      bitcoind.unsubscribe = sinon.stub();
      var events = bitcoind.getPublishEvents();

      events[0].subscribe('test');
      bitcoind.subscribe.args[0][0].should.equal('rawtransaction');
      bitcoind.subscribe.args[0][1].should.equal('test');

      events[0].unsubscribe('test');
      bitcoind.unsubscribe.args[0][0].should.equal('rawtransaction');
      bitcoind.unsubscribe.args[0][1].should.equal('test');

      events[1].subscribe('test');
      bitcoind.subscribe.args[1][0].should.equal('hashblock');
      bitcoind.subscribe.args[1][1].should.equal('test');

      events[1].unsubscribe('test');
      bitcoind.unsubscribe.args[1][0].should.equal('hashblock');
      bitcoind.unsubscribe.args[1][1].should.equal('test');
    });
  });

  describe('#subscribe', function() {
    it('will push to subscriptions', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var emitter = {};
      bitcoind.subscribe('hashblock', emitter);
      bitcoind.subscriptions.hashblock[0].should.equal(emitter);

      var emitter2 = {};
      bitcoind.subscribe('rawtransaction', emitter2);
      bitcoind.subscriptions.rawtransaction[0].should.equal(emitter2);
    });
  });

  describe('#unsubscribe', function() {
    it('will remove item from subscriptions', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var emitter1 = {};
      var emitter2 = {};
      var emitter3 = {};
      var emitter4 = {};
      var emitter5 = {};
      bitcoind.subscribe('hashblock', emitter1);
      bitcoind.subscribe('hashblock', emitter2);
      bitcoind.subscribe('hashblock', emitter3);
      bitcoind.subscribe('hashblock', emitter4);
      bitcoind.subscribe('hashblock', emitter5);
      bitcoind.subscriptions.hashblock.length.should.equal(5);

      bitcoind.unsubscribe('hashblock', emitter3);
      bitcoind.subscriptions.hashblock.length.should.equal(4);
      bitcoind.subscriptions.hashblock[0].should.equal(emitter1);
      bitcoind.subscriptions.hashblock[1].should.equal(emitter2);
      bitcoind.subscriptions.hashblock[2].should.equal(emitter4);
      bitcoind.subscriptions.hashblock[3].should.equal(emitter5);
    });
  });

  describe('#_getDefaultConfig', function() {
    it('will generate config file from defaults', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var config = bitcoind._getDefaultConfig();
      config.should.equal(defaultBitcoinConf);
    });
  });

  describe('#_loadSpawnConfiguration', function() {
    it('will parse a bitcoin.conf file', function() {
      var TestBitcoin = proxyquire('../../lib/services/bitcoind', {
        fs: {
          readFileSync: readFileSync,
          existsSync: sinon.stub().returns(true),
          writeFileSync: sinon.stub()
        },
        mkdirp: {
          sync: sinon.stub()
        }
      });
      var bitcoind = new TestBitcoin(baseConfig);
      bitcoind._loadSpawnConfiguration({datadir: process.env.HOME + '/.bitcoin'});
      should.exist(bitcoind.spawn.config);
      bitcoind.spawn.config.should.deep.equal({
        addressindex: 1,
        checkblocks: 144,
        dbcache: 8192,
        maxuploadtarget: 1024,
        port: 20000,
        rpcport: 50001,
        rpcallowip: '127.0.0.1',
        rpcuser: 'bitcoin',
        rpcpassword: 'local321',
        server: 1,
        spentindex: 1,
        timestampindex: 1,
        txindex: 1,
        upnp: 0,
        whitelist: '127.0.0.1',
        zmqpubhashblock: 'tcp://127.0.0.1:28332',
        zmqpubrawtx: 'tcp://127.0.0.1:28332'
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
        bitcoind._loadSpawnConfiguration({datadir: './test'});
      }).should.throw(bitcore.errors.InvalidState);
    });
    it('should NOT set https options if node https options are set', function() {
      var writeFileSync = function(path, config) {
        config.should.equal(defaultBitcoinConf);
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
          network: {
            name: 'regtest'
          },
          https: true,
          httpsOptions: {
            key: 'key.pem',
            cert: 'cert.pem'
          }
        },
        spawn: {
          datadir: 'testdir',
          exec: 'testexec'
        }
      };
      var bitcoind = new TestBitcoin(config);
      bitcoind._loadSpawnConfiguration({datadir: process.env.HOME + '/.bitcoin'});
    });
  });

  describe('#_checkConfigIndexes', function() {
    var stub;
    beforeEach(function() {
      stub = sinon.stub(log, 'warn');
    });
    after(function() {
      stub.restore();
    });
    it('should warn the user if reindex is set to 1 in the bitcoin.conf file', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var config = {
        txindex: 1,
        addressindex: 1,
        spentindex: 1,
        server: 1,
        zmqpubrawtx: 1,
        zmqpubhashblock: 1,
        reindex: 1
      };
      var node = {};
      bitcoind._checkConfigIndexes(config, node);
      log.warn.callCount.should.equal(1);
      node._reindex.should.equal(true);
    });
  });

  describe('#_resetCaches', function() {
    it('will reset LRU caches', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var keys = [];
      for (var i = 0; i < 10; i++) {
        keys.push(crypto.randomBytes(32));
        bitcoind.transactionInfoCache.set(keys[i], {});
        bitcoind.utxosCache.set(keys[i], {});
        bitcoind.txidsCache.set(keys[i], {});
        bitcoind.balanceCache.set(keys[i], {});
        bitcoind.summaryCache.set(keys[i], {});
      }
      bitcoind._resetCaches();
      should.equal(bitcoind.transactionInfoCache.get(keys[0]), undefined);
      should.equal(bitcoind.utxosCache.get(keys[0]), undefined);
      should.equal(bitcoind.txidsCache.get(keys[0]), undefined);
      should.equal(bitcoind.balanceCache.get(keys[0]), undefined);
      should.equal(bitcoind.summaryCache.get(keys[0]), undefined);
    });
  });

  describe('#_tryAll', function() {
    it('will retry the number of bitcoind nodes', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.tryAllInterval = 1;
      bitcoind.nodes.push({});
      bitcoind.nodes.push({});
      bitcoind.nodes.push({});
      var count = 0;
      var func = function(callback) {
        count++;
        if (count <= 2) {
          callback(new Error('test'));
        } else {
          callback();
        }
      };
      bitcoind._tryAll(function(next) {
        func(next);
      }, function() {
        count.should.equal(3);
        done();
      });
    });
    it('will get error if all fail', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.tryAllInterval = 1;
      bitcoind.nodes.push({});
      bitcoind.nodes.push({});
      bitcoind.nodes.push({});
      var count = 0;
      var func = function(callback) {
        count++;
        callback(new Error('test'));
      };
      bitcoind._tryAll(function(next) {
        func(next);
      }, function(err) {
        should.exist(err);
        err.message.should.equal('test');
        count.should.equal(3);
        done();
      });
    });
  });

  describe('#_wrapRPCError', function() {
    it('will convert bitcoind-rpc error object into JavaScript error', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var error = bitcoind._wrapRPCError({message: 'Test error', code: -1});
      error.should.be.an.instanceof(errors.RPCError);
      error.code.should.equal(-1);
      error.message.should.equal('Test error');
    });
  });

  describe('#_initChain', function() {
    var sandbox = sinon.sandbox.create();
    beforeEach(function() {
      sandbox.stub(log, 'info');
    });
    afterEach(function() {
      sandbox.restore();
    });
    it('will set height and genesis buffer', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var genesisBuffer = new Buffer([]);
      bitcoind.getRawBlock = sinon.stub().callsArgWith(1, null, genesisBuffer);
      bitcoind.nodes.push({
        client: {
          getBestBlockHash: function(callback) {
            callback(null, {
              result: 'bestblockhash'
            });
          },
          getBlock: function(hash, callback) {
            if (hash === 'bestblockhash') {
              callback(null, {
                result: {
                  height: 5000
                }
              });
            }
          },
          getBlockHash: function(num, callback) {
            callback(null, {
              result: 'genesishash'
            });
          }
        }
      });
      bitcoind._initChain(function() {
        log.info.callCount.should.equal(1);
        bitcoind.getRawBlock.callCount.should.equal(1);
        bitcoind.getRawBlock.args[0][0].should.equal('genesishash');
        bitcoind.height.should.equal(5000);
        bitcoind.genesisBuffer.should.equal(genesisBuffer);
        done();
      });
    });
  });

  describe('#_getNetworkOption', function() {
    afterEach(function() {
      bitcore.Networks.disableRegtest();
      baseConfig.node.network = bitcore.Networks.testnet;
    });
    it('return --testnet for testnet', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.node.network = bitcore.Networks.testnet;
      bitcoind._getNetworkOption().should.equal('--testnet');
    });
    it('return --regtest for testnet', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.node.network = bitcore.Networks.testnet;
      bitcore.Networks.enableRegtest();
      bitcoind._getNetworkOption().should.equal('--regtest');
    });
    it('return undefined for livenet', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.node.network = bitcore.Networks.livenet;
      bitcore.Networks.enableRegtest();
      should.equal(bitcoind._getNetworkOption(), undefined);
    });
  });

  describe('#_zmqBlockHandler', function() {
    it('will emit block', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var node = {};
      var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
      bitcoind._rapidProtectedUpdateTip = sinon.stub();
      bitcoind.on('block', function(block) {
        block.should.equal(message);
        done();
      });
      bitcoind._zmqBlockHandler(node, message);
    });
    it('will not emit same block twice', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var node = {};
      var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
      bitcoind._rapidProtectedUpdateTip = sinon.stub();
      bitcoind.on('block', function(block) {
        block.should.equal(message);
        done();
      });
      bitcoind._zmqBlockHandler(node, message);
      bitcoind._zmqBlockHandler(node, message);
    });
    it('will call function to update tip', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var node = {};
      var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
      bitcoind._rapidProtectedUpdateTip = sinon.stub();
      bitcoind._zmqBlockHandler(node, message);
      bitcoind._rapidProtectedUpdateTip.callCount.should.equal(1);
      bitcoind._rapidProtectedUpdateTip.args[0][0].should.equal(node);
      bitcoind._rapidProtectedUpdateTip.args[0][1].should.equal(message);
    });
    it('will emit to subscribers', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var node = {};
      var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
      bitcoind._rapidProtectedUpdateTip = sinon.stub();
      var emitter = new EventEmitter();
      bitcoind.subscriptions.hashblock.push(emitter);
      emitter.on('bitcoind/hashblock', function(blockHash) {
        blockHash.should.equal(message.toString('hex'));
        done();
      });
      bitcoind._zmqBlockHandler(node, message);
    });
  });

  describe('#_rapidProtectedUpdateTip', function() {
    it('will limit tip updates with rapid calls', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var callCount = 0;
      bitcoind._updateTip = function() {
        callCount++;
        callCount.should.be.within(1, 2);
        if (callCount > 1) {
          done();
        }
      };
      var node = {};
      var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
      var count = 0;
      function repeat() {
        bitcoind._rapidProtectedUpdateTip(node, message);
        count++;
        if (count < 50) {
          repeat();
        }
      }
      repeat();
    });
  });

  describe('#_updateTip', function() {
    var sandbox = sinon.sandbox.create();
    var message = new Buffer('00000000002e08fc7ae9a9aa5380e95e2adcdc5752a4a66a7d3a22466bd4e6aa', 'hex');
    beforeEach(function() {
      sandbox.stub(log, 'error');
      sandbox.stub(log, 'info');
    });
    afterEach(function() {
      sandbox.restore();
    });
    it('log and emit rpc error from get block', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub();
      bitcoind.on('error', function(err) {
        err.code.should.equal(-1);
        err.message.should.equal('Test error');
        log.error.callCount.should.equal(1);
        done();
      });
      var node = {
        client: {
          getBlock: sinon.stub().callsArgWith(1, {message: 'Test error', code: -1})
        }
      };
      bitcoind._updateTip(node, message);
    });
    it('emit synced if percentage is 100', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 100);
      bitcoind.on('synced', function() {
        done();
      });
      var node = {
        client: {
          getBlock: sinon.stub()
        }
      };
      bitcoind._updateTip(node, message);
    });
    it('NOT emit synced if percentage is less than 100', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 99);
      bitcoind.on('synced', function() {
        throw new Error('Synced called');
      });
      var node = {
        client: {
          getBlock: sinon.stub()
        }
      };
      bitcoind._updateTip(node, message);
      log.info.callCount.should.equal(1);
      done();
    });
    it('log and emit error from syncPercentage', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, new Error('test'));
      bitcoind.on('error', function(err) {
        log.error.callCount.should.equal(1);
        err.message.should.equal('test');
        done();
      });
      var node = {
        client: {
          getBlock: sinon.stub()
        }
      };
      bitcoind._updateTip(node, message);
    });
    it('reset caches and set height', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub();
      bitcoind._resetCaches = sinon.stub();
      bitcoind.on('tip', function(height) {
        bitcoind._resetCaches.callCount.should.equal(1);
        height.should.equal(10);
        bitcoind.height.should.equal(10);
        done();
      });
      var node = {
        client: {
          getBlock: sinon.stub().callsArgWith(1, null, {
            result: {
              height: 10
            }
          })
        }
      };
      bitcoind._updateTip(node, message);
    });
    it('will NOT update twice for the same hash', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub();
      bitcoind._resetCaches = sinon.stub();
      bitcoind.on('tip', function() {
        done();
      });
      var node = {
        client: {
          getBlock: sinon.stub().callsArgWith(1, null, {
            result: {
              height: 10
            }
          })
        }
      };
      bitcoind._updateTip(node, message);
      bitcoind._updateTip(node, message);
    });
  });

  describe('#_zmqTransactionHandler', function() {
    it('will emit to subscribers', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedBuffer = new Buffer('abcdef', 'hex');
      var emitter = new EventEmitter();
      bitcoind.subscriptions.rawtransaction.push(emitter);
      emitter.on('bitcoind/rawtransaction', function(hex) {
        hex.should.be.a('string');
        hex.should.equal(expectedBuffer.toString('hex'));
        done();
      });
      var node = {};
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
    });
    it('will NOT emit to subscribers more than once for the same tx', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedBuffer = new Buffer('abcdef', 'hex');
      var emitter = new EventEmitter();
      bitcoind.subscriptions.rawtransaction.push(emitter);
      emitter.on('bitcoind/rawtransaction', function() {
        done();
      });
      var node = {};
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
    });
    it('will emit "tx" event', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedBuffer = new Buffer('abcdef', 'hex');
      bitcoind.on('tx', function(buffer) {
        buffer.should.be.instanceof(Buffer);
        buffer.toString('hex').should.equal(expectedBuffer.toString('hex'));
        done();
      });
      var node = {};
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
    });
    it('will NOT emit "tx" event more than once for the same tx', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedBuffer = new Buffer('abcdef', 'hex');
      bitcoind.on('tx', function() {
        done();
      });
      var node = {};
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
      bitcoind._zmqTransactionHandler(node, expectedBuffer);
    });
  });

  describe('#_subscribeZmqEvents', function() {
    it('will call subscribe on zmq socket', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var node = {
        zmqSubSocket: {
          subscribe: sinon.stub(),
          on: sinon.stub()
        }
      };
      bitcoind._subscribeZmqEvents(node);
      node.zmqSubSocket.subscribe.callCount.should.equal(2);
      node.zmqSubSocket.subscribe.args[0][0].should.equal('hashblock');
      node.zmqSubSocket.subscribe.args[1][0].should.equal('rawtx');
    });
    it('will call relevant handler for rawtx topics', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind._zmqTransactionHandler = sinon.stub();
      var node = {
        zmqSubSocket: new EventEmitter()
      };
      node.zmqSubSocket.subscribe = sinon.stub();
      bitcoind._subscribeZmqEvents(node);
      node.zmqSubSocket.on('message', function() {
        bitcoind._zmqTransactionHandler.callCount.should.equal(1);
        done();
      });
      var topic = new Buffer('rawtx', 'utf8');
      var message = new Buffer('abcdef', 'hex');
      node.zmqSubSocket.emit('message', topic, message);
    });
    it('will call relevant handler for hashblock topics', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind._zmqBlockHandler = sinon.stub();
      var node = {
        zmqSubSocket: new EventEmitter()
      };
      node.zmqSubSocket.subscribe = sinon.stub();
      bitcoind._subscribeZmqEvents(node);
      node.zmqSubSocket.on('message', function() {
        bitcoind._zmqBlockHandler.callCount.should.equal(1);
        done();
      });
      var topic = new Buffer('hashblock', 'utf8');
      var message = new Buffer('abcdef', 'hex');
      node.zmqSubSocket.emit('message', topic, message);
    });
  });

  describe('#_initZmqSubSocket', function() {
  });

  describe('#_checkReindex', function() {
    var sandbox = sinon.sandbox.create();
    before(function() {
      sandbox.stub(log, 'info');
    });
    after(function() {
      sandbox.restore();
    });
    it('give error from client syncpercentage', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind._reindexWait = 1;
      var node = {
        _reindex: true,
        client: {
          syncPercentage: sinon.stub().callsArgWith(0, {code: -1 , message: 'Test error'})
        }
      };
      bitcoind._checkReindex(node, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
        done();
      });
    });
    it('will wait until syncpercentage is 100 percent', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind._reindexWait = 1;
      var percent = 90;
      var node = {
        _reindex: true,
        client: {
          syncPercentage: function(callback) {
            callback(null, percent++);
          }
        }
      };
      bitcoind._checkReindex(node, function() {
        node._reindex.should.equal(false);
        log.info.callCount.should.equal(11);
        done();
      });
    });
  });

  describe('#_loadTipFromNode', function() {
  });

  describe('#_spawnChildProcess', function() {
  });

  describe('#_connectProcess', function() {
  });

  describe('#start', function() {
  });

  describe('#isSynced', function() {
    it('will give error from syncPercentage', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, new Error('test'));
      bitcoind.isSynced(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });
    it('will give "true" if percentage is 100.00', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 100.00);
      bitcoind.isSynced(function(err, synced) {
        if (err) {
          return done(err);
        }
        synced.should.equal(true);
        done();
      });
    });
    it('will give "true" if percentage is 99.98', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 99.98);
      bitcoind.isSynced(function(err, synced) {
        if (err) {
          return done(err);
        }
        synced.should.equal(true);
        done();
      });
    });
    it('will give "false" if percentage is 99.49', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 99.49);
      bitcoind.isSynced(function(err, synced) {
        if (err) {
          return done(err);
        }
        synced.should.equal(false);
        done();
      });
    });
    it('will give "false" if percentage is 1', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.syncPercentage = sinon.stub().callsArgWith(0, null, 1);
      bitcoind.isSynced(function(err, synced) {
        if (err) {
          return done(err);
        }
        synced.should.equal(false);
        done();
      });
    });
  });

  describe('#syncPercentage', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlockchainInfo = sinon.stub().callsArgWith(0, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getBlockchainInfo: getBlockchainInfo
        }
      });
      bitcoind.syncPercentage(function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will call client getInfo and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlockchainInfo = sinon.stub().callsArgWith(0, null, {
        result: {
          verificationprogress: '0.983821387'
        }
      });
      bitcoind.nodes.push({
        client: {
          getBlockchainInfo: getBlockchainInfo
        }
      });
      bitcoind.syncPercentage(function(err, percentage) {
        if (err) {
          return done(err);
        }
        percentage.should.equal(98.3821387);
        done();
      });
    });
  });

  describe('#_normalizeAddressArg', function() {
    it('will turn single address into array', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var args = bitcoind._normalizeAddressArg('address');
      args.should.deep.equal(['address']);
    });
    it('will keep an array as an array', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var args = bitcoind._normalizeAddressArg(['address', 'address']);
      args.should.deep.equal(['address', 'address']);
    });
  });

  describe('#getAddressBalance', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressBalance: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      var options = {};
      bitcoind.getAddressBalance(address, options, function(err) {
        err.should.be.instanceof(Error);
        done();
      });
    });
    it('will give balance', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressBalance: sinon.stub().callsArgWith(1, null, {
            result: {
              received: 100000,
              balance: 10000
            }
          })
        }
      });
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      var options = {};
      bitcoind.getAddressBalance(address, options, function(err, data) {
        if (err) {
          return done(err);
        }
        data.balance.should.equal(10000);
        data.received.should.equal(100000);
        done();
      });
    });
  });

  describe('#getAddressUnspentOutputs', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressUtxos: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      var options = {};
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressUnspentOutputs(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
        done();
      });
    });
    it('will give results from client getaddressutxos', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedUtxos = [
        {
          address: '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo',
          txid: '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0',
          outputIndex: 1,
          script: '76a914f399b4b8894f1153b96fce29f05e6e116eb4c21788ac',
          satoshis: 7679241,
          height: 207111
        }
      ];
      bitcoind.nodes.push({
        client: {
          getAddressUtxos: sinon.stub().callsArgWith(1, null, {
            result: expectedUtxos
          })
        }
      });
      var options = {};
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressUnspentOutputs(address, options, function(err, utxos) {
        if (err) {
          return done(err);
        }
        utxos.length.should.equal(1);
        utxos.should.deep.equal(expectedUtxos);
        done();
      });
    });
    it('will use cache', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var expectedUtxos = [
        {
          address: '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo',
          txid: '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0',
          outputIndex: 1,
          script: '76a914f399b4b8894f1153b96fce29f05e6e116eb4c21788ac',
          satoshis: 7679241,
          height: 207111
        }
      ];
      var getAddressUtxos = sinon.stub().callsArgWith(1, null, {
        result: expectedUtxos
      });
      bitcoind.nodes.push({
        client: {
          getAddressUtxos: getAddressUtxos
        }
      });
      var options = {};
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressUnspentOutputs(address, options, function(err, utxos) {
        if (err) {
          return done(err);
        }
        utxos.length.should.equal(1);
        utxos.should.deep.equal(expectedUtxos);
        getAddressUtxos.callCount.should.equal(1);
        bitcoind.getAddressUnspentOutputs(address, options, function(err, utxos) {
          if (err) {
            return done(err);
          }
          utxos.length.should.equal(1);
          utxos.should.deep.equal(expectedUtxos);
          getAddressUtxos.callCount.should.equal(1);
          done();
        });
      });
    });
  });

  describe('#_getBalanceFromMempool', function() {
  });

  describe('#_getTxidsMempool', function() {
  });

  describe('#_getHeightRangeQuery', function() {
  });

  describe('#getAddressTxids', function() {
    it('will give rpc error from mempool query', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      var options = {};
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
      });
    });
    it('will give rpc error from txids query', function() {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressTxids: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      var options = {
        queryMempool: false
      };
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
      });
    });
    it('will get txid results', function(done) {
      var expectedTxids = [
        'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce',
        'f637384e9f81f18767ea50e00bce58fc9848b6588a1130529eebba22a410155f',
        'f3c1ba3ef86a0420d6102e40e2cfc8682632ab95d09d86a27f5d466b9fa9da47',
        '56fafeb01961831b926558d040c246b97709fd700adcaa916541270583e8e579',
        'bc992ad772eb02864db07ef248d31fb3c6826d25f1153ebf8c79df9b7f70fcf2',
        'f71bccef3a8f5609c7f016154922adbfe0194a96fb17a798c24077c18d0a9345',
        'f35e7e2a2334e845946f3eaca76890d9a68f4393ccc9fe37a0c2fb035f66d2e9',
        'edc080f2084eed362aa488ccc873a24c378dc0979aa29b05767517b70569414a',
        'ed11a08e3102f9610bda44c80c46781d97936a4290691d87244b1b345b39a693',
        'ec94d845c603f292a93b7c829811ac624b76e52b351617ca5a758e9d61a11681'
      ];
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressTxids: sinon.stub().callsArgWith(1, null, {
            result: expectedTxids.reverse()
          })
        }
      });
      var options = {
        queryMempool: false
      };
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, options, function(err, txids) {
        if (err) {
          return done(err);
        }
        txids.length.should.equal(expectedTxids.length);
        txids.should.deep.equal(expectedTxids);
        done();
      });
    });
    it('will get txid results from cache', function(done) {
      var expectedTxids = [
        'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce'
      ];
      var bitcoind = new BitcoinService(baseConfig);
      var getAddressTxids = sinon.stub().callsArgWith(1, null, {
        result: expectedTxids.reverse()
      });
      bitcoind.nodes.push({
        client: {
          getAddressTxids: getAddressTxids
        }
      });
      var options = {
        queryMempool: false
      };
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, options, function(err, txids) {
        if (err) {
          return done(err);
        }
        getAddressTxids.callCount.should.equal(1);
        txids.should.deep.equal(expectedTxids);

        bitcoind.getAddressTxids(address, options, function(err, txids) {
          if (err) {
            return done(err);
          }
          getAddressTxids.callCount.should.equal(1);
          txids.should.deep.equal(expectedTxids);
          done();
        });
      });
    });
    it('will get txid results WITHOUT cache if rangeQuery and exclude mempool', function(done) {
      var expectedTxids = [
        'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce'
      ];
      var bitcoind = new BitcoinService(baseConfig);
      var getAddressMempool = sinon.stub();
      var getAddressTxids = sinon.stub().callsArgWith(1, null, {
        result: expectedTxids.reverse()
      });
      bitcoind.nodes.push({
        client: {
          getAddressTxids: getAddressTxids,
          getAddressMempool: getAddressMempool
        }
      });
      var options = {
        queryMempool: true, // start and end will exclude mempool
        start: 4,
        end: 2
      };
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, options, function(err, txids) {
        if (err) {
          return done(err);
        }
        getAddressTxids.callCount.should.equal(1);
        getAddressMempool.callCount.should.equal(0);
        txids.should.deep.equal(expectedTxids);

        bitcoind.getAddressTxids(address, options, function(err, txids) {
          if (err) {
            return done(err);
          }
          getAddressTxids.callCount.should.equal(2);
          getAddressMempool.callCount.should.equal(0);
          txids.should.deep.equal(expectedTxids);
          done();
        });
      });
    });
    it('will get txid results from cache and live mempool', function(done) {
      var expectedTxids = [
        'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce'
      ];
      var bitcoind = new BitcoinService(baseConfig);
      var getAddressTxids = sinon.stub().callsArgWith(1, null, {
        result: expectedTxids.reverse()
      });
      var getAddressMempool = sinon.stub().callsArgWith(1, null, {
        result: [
          {
            txid: 'bc992ad772eb02864db07ef248d31fb3c6826d25f1153ebf8c79df9b7f70fcf2'
          },
          {
            txid: 'f71bccef3a8f5609c7f016154922adbfe0194a96fb17a798c24077c18d0a9345'
          },
          {
            txid: 'f35e7e2a2334e845946f3eaca76890d9a68f4393ccc9fe37a0c2fb035f66d2e9'
          }
        ]
      });
      bitcoind.nodes.push({
        client: {
          getAddressTxids: getAddressTxids,
          getAddressMempool: getAddressMempool
        }
      });
      var address = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      bitcoind.getAddressTxids(address, {queryMempool: false}, function(err, txids) {
        if (err) {
          return done(err);
        }
        getAddressTxids.callCount.should.equal(1);
        txids.should.deep.equal(expectedTxids);

        bitcoind.getAddressTxids(address, {queryMempool: true}, function(err, txids) {
          if (err) {
            return done(err);
          }
          getAddressTxids.callCount.should.equal(1);
          txids.should.deep.equal([
            'f35e7e2a2334e845946f3eaca76890d9a68f4393ccc9fe37a0c2fb035f66d2e9', // mempool
            'f71bccef3a8f5609c7f016154922adbfe0194a96fb17a798c24077c18d0a9345', // mempool
            'bc992ad772eb02864db07ef248d31fb3c6826d25f1153ebf8c79df9b7f70fcf2', // mempool
            'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce' // confirmed
          ]);
          done();
        });
      });
    });
  });

  describe('#_getConfirmationDetail', function() {
    var sandbox = sinon.sandbox.create();
    beforeEach(function() {
      sandbox.stub(log, 'warn');
    });
    afterEach(function() {
      sandbox.restore();
    });
    it('should get 1 confirmation', function() {
      var tx = new Transaction(txhex);
      tx.__height = 10;
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.height = 10;
      var confirmations = bitcoind._getConfirmationsDetail(tx);
      confirmations.should.equal(1);
    });
    it('should get 2 confirmation', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var tx = new Transaction(txhex);
      bitcoind.height = 11;
      tx.__height = 10;
      var confirmations = bitcoind._getConfirmationsDetail(tx);
      confirmations.should.equal(2);
    });
    it('should get 0 confirmation with overflow', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var tx = new Transaction(txhex);
      bitcoind.height = 3;
      tx.__height = 10;
      var confirmations = bitcoind._getConfirmationsDetail(tx);
      log.warn.callCount.should.equal(1);
      confirmations.should.equal(0);
    });
    it('should get 1000 confirmation', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var tx = new Transaction(txhex);
      bitcoind.height = 1000;
      tx.__height = 1;
      var confirmations = bitcoind._getConfirmationsDetail(tx);
      confirmations.should.equal(1000);
    });
  });

  describe('#_getAddressDetailsForTransaction', function() {
    it('will calculate details for the transaction', function(done) {
      /* jshint sub:true */
      var tx = bitcore.Transaction({
        'hash': 'b12b3ae8489c5a566b629a3c62ce4c51c3870af550fb5dc77d715b669a91343c',
        'version': 1,
        'inputs': [
          {
            'prevTxId': 'a2b7ea824a92f4a4944686e67ec1001bc8785348b8c111c226f782084077b543',
            'outputIndex': 0,
            'sequenceNumber': 4294967295,
            'script': '47304402201b81c933297241960a57ae1b2952863b965ac8c9ec7466ff0b715712d27548d50220576e115b63864f003889443525f47c7cf0bc1e2b5108398da085b221f267ba2301210229766f1afa25ca499a51f8e01c292b0255a21a41bb6685564a1607a811ffe924',
            'scriptString': '71 0x304402201b81c933297241960a57ae1b2952863b965ac8c9ec7466ff0b715712d27548d50220576e115b63864f003889443525f47c7cf0bc1e2b5108398da085b221f267ba2301 33 0x0229766f1afa25ca499a51f8e01c292b0255a21a41bb6685564a1607a811ffe924',
            'output': {
              'satoshis': 1000000000,
              'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
            }
          }
        ],
        'outputs': [
          {
            'satoshis': 100000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 200000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 50000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 300000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 349990000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          }
        ],
        'nLockTime': 0
      });
      var bitcoind = new BitcoinService(baseConfig);
      var addresses = ['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'];
      var details = bitcoind._getAddressDetailsForTransaction(tx, addresses);
      should.exist(details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW']);
      details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'].inputIndexes.should.deep.equal([0]);
      details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'].outputIndexes.should.deep.equal([
        0, 1, 2, 3, 4
      ]);
      details.satoshis.should.equal(-10000);
      done();
    });
  });

  describe('#_getDetailedTransaction', function() {
    it('will get detailed transaction info', function(done) {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var tx = {
        populateInputs: sinon.stub().callsArg(2),
        __height: 20,
        __timestamp: 1453134151,
        isCoinbase: sinon.stub().returns(false),
        getFee: sinon.stub().returns(1000)
      };
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.getTransactionWithBlockInfo = sinon.stub().callsArgWith(1, null, tx);
      bitcoind.height = 300;
      bitcoind._getAddressDetailsForTransaction = sinon.stub().returns({
        addresses: {},
        satoshis: 1000,
      });
      bitcoind._getDetailedTransaction(txid, {}, function(err) {
        if (err) {
          return done(err);
        }
        done();
      });
    });
    it('give error from getTransactionWithBlockInfo', function(done) {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.getTransactionWithBlockInfo = sinon.stub().callsArgWith(1, new Error('test'));
      bitcoind._getDetailedTransaction(txid, {}, function(err) {
        err.should.be.instanceof(Error);
        done();
      });
    });
    it('give error from populateInputs', function(done) {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var tx = {
        populateInputs: sinon.stub().callsArgWith(2, new Error('test')),
      };
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.getTransactionWithBlockInfo = sinon.stub().callsArgWith(1, null, tx);
      bitcoind._getDetailedTransaction(txid, {}, function(err) {
        err.should.be.instanceof(Error);
        done();
      });
    });

    it('will correct detailed info', function(done) {
      // block #314159
      // txid 30169e8bf78bc27c4014a7aba3862c60e2e3cce19e52f1909c8255e4b7b3174e
      // outputIndex 1
      var txAddress = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      var txString = '0100000001a08ee59fcd5d86fa170abb6d925d62d5c5c476359681b70877c04f270c4ef246000000008a47304402203fb9b476bb0c37c9b9ed5784ebd67ae589492be11d4ae1612be29887e3e4ce750220741ef83781d1b3a5df8c66fa1957ad0398c733005310d7d9b1d8c2310ef4f74c0141046516ad02713e51ecf23ac9378f1069f9ae98e7de2f2edbf46b7836096e5dce95a05455cc87eaa1db64f39b0c63c0a23a3b8df1453dbd1c8317f967c65223cdf8ffffffff02b0a75fac000000001976a91484b45b9bf3add8f7a0f3daad305fdaf6b73441ea88ac20badc02000000001976a914809dc14496f99b6deb722cf46d89d22f4beb8efd88ac00000000';
      var previousTxString = '010000000155532fad2869bb951b0bd646a546887f6ee668c4c0ee13bf3f1c4bce6d6e3ed9000000008c4930460221008540795f4ef79b1d2549c400c61155ca5abbf3089c84ad280e1ba6db2a31abce022100d7d162175483d51174d40bba722e721542c924202a0c2970b07e680b51f3a0670141046516ad02713e51ecf23ac9378f1069f9ae98e7de2f2edbf46b7836096e5dce95a05455cc87eaa1db64f39b0c63c0a23a3b8df1453dbd1c8317f967c65223cdf8ffffffff02f0af3caf000000001976a91484b45b9bf3add8f7a0f3daad305fdaf6b73441ea88ac80969800000000001976a91421277e65777760d1f3c7c982ba14ed8f934f005888ac00000000';
      var transaction = new Transaction();
      var previousTransaction = new Transaction();
      previousTransaction.fromString(previousTxString);
      var previousTransactionTxid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      transaction.fromString(txString);
      var txid = transaction.hash;
      transaction.__blockHash = '00000000000000001bb82a7f5973618cfd3185ba1ded04dd852a653f92a27c45';
      transaction.__height = 314159;
      transaction.__timestamp = 1407292005;
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.height = 314159;
      bitcoind.getTransactionWithBlockInfo = sinon.stub().callsArgWith(1, null, transaction);
      bitcoind.getTransaction = function(prevTxid, callback) {
        prevTxid.should.equal(previousTransactionTxid);
        setImmediate(function() {
          callback(null, previousTransaction);
        });
      };
      var transactionInfo = {
        addresses: {},
        txid: txid,
        timestamp: 1407292005,
        satoshis: 48020000,
        address: txAddress
      };
      transactionInfo.addresses[txAddress] = {};
      transactionInfo.addresses[txAddress].outputIndexes = [1];
      transactionInfo.addresses[txAddress].inputIndexes = [];
      bitcoind._getAddressDetailsForTransaction = sinon.stub().returns(transactionInfo);
      bitcoind._getDetailedTransaction(txid, {}, function(err, info) {
        if (err) {
          return done(err);
        }
        info.addresses[txAddress].should.deep.equal({
          outputIndexes: [1],
          inputIndexes: []
        });
        info.satoshis.should.equal(48020000);
        info.height.should.equal(314159);
        info.confirmations.should.equal(1);
        info.timestamp.should.equal(1407292005);
        info.fees.should.equal(20000);
        info.tx.should.equal(transaction);
        done();
      });
    });
  });

  describe('#_getAddressStrings', function() {
  });

  describe('#_paginateTxids', function() {
    it('slice txids based on "from" and "to" (3 to 30)', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      var paginated = bitcoind._paginateTxids(txids, 3, 30);
      paginated.should.deep.equal([3, 4, 5, 6, 7, 8, 9, 10]);
    });
    it('slice txids based on "from" and "to" (0 to 3)', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      var paginated = bitcoind._paginateTxids(txids, 0, 3);
      paginated.should.deep.equal([0, 1, 2]);
    });
    it('slice txids based on "from" and "to" (0 to 1)', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      var paginated = bitcoind._paginateTxids(txids, 0, 1);
      paginated.should.deep.equal([0]);
    });
    it('will throw error if "from" is greater than "to"', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      (function() {
        var paginated = bitcoind._paginateTxids(txids, 1, 0);
      }).should.throw('"from" is expected to be less than "to"');
    });
  });

  describe('#getAddressHistory', function() {
    var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
    it('will give an error if length of addresses is too long', function(done) {
      var addresses = [];
      for (var i = 0; i < 101; i++) {
        addresses.push(address);
      }
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.maxAddressesQuery = 100;
      bitcoind.getAddressHistory(addresses, {}, function(err) {
        should.exist(err);
        err.message.match(/Maximum/);
        done();
      });
    });
    it('give error from getAddressTxids', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, new Error('test'));
      bitcoind.getAddressHistory('address', {}, function(err) {
        should.exist(err);
        err.should.be.instanceof(Error);
        err.message.should.equal('test');
        done();
      });
    });
    it('will paginate', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind._getDetailedTransaction = function(txid, options, callback) {
        callback(null, txid);
      };
      var txids = ['one', 'two', 'three', 'four'];
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, null, txids);
      bitcoind.getAddressHistory('address', {from: 1, to: 3}, function(err, data) {
        if (err) {
          return done(err);
        }
        data.items.length.should.equal(2);
        data.items.should.deep.equal(['two', 'three']);
        done();
      });
    });
  });

  describe('#getAddressSummary', function() {
    var txid1 = '70d9d441d7409aace8e0ffe24ff0190407b2fcb405799a266e0327017288d1f8';
    var txid2 = '35fafaf572341798b2ce2858755afa7c8800bb6b1e885d3e030b81255b5e172d';
    var txid3 = '57b7842afc97a2b46575b490839df46e9273524c6ea59ba62e1e86477cf25247';
    var memtxid1 = 'b1bfa8dbbde790cb46b9763ef3407c1a21c8264b67bfe224f462ec0e1f569e92';
    var memtxid2 = 'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce';

    it('will handle error from getAddressTxids', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, null, {
            result: [
              {
                txid: '70d9d441d7409aace8e0ffe24ff0190407b2fcb405799a266e0327017288d1f8',
              }
            ]
          })
        }
      });
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, new Error('test'));
      bitcoind.getAddressBalance = sinon.stub().callsArgWith(2, null, {});
      var address = '';
      var options = {};
      bitcoind.getAddressSummary(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(Error);
        err.message.should.equal('test');
        done();
      });
    });
    it('will handle error from getAddressBalance', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, null, {
            result: [
              {
                txid: '70d9d441d7409aace8e0ffe24ff0190407b2fcb405799a266e0327017288d1f8',
              }
            ]
          })
        }
      });
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, null, {});
      bitcoind.getAddressBalance = sinon.stub().callsArgWith(2, new Error('test'), {});
      var address = '';
      var options = {};
      bitcoind.getAddressSummary(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(Error);
        err.message.should.equal('test');
        done();
      });
    });
    it('will handle error from client getAddressMempool', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, null, {});
      bitcoind.getAddressBalance = sinon.stub().callsArgWith(2, null, {});
      var address = '';
      var options = {};
      bitcoind.getAddressSummary(address, options, function(err) {
        should.exist(err);
        err.should.be.instanceof(Error);
        err.message.should.equal('Test error');
        done();
      });
    });
    it('should set all properties', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, null, {
            result: [
              {
                txid: memtxid1,
                satoshis: -1000000
              },
              {
                txid: memtxid2,
                satoshis: 99999
              }
            ]
          })
        }
      });
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, null, [txid1, txid2, txid3]);
      bitcoind.getAddressBalance = sinon.stub().callsArgWith(2, null, {
        received: 30 * 1e8,
        balance: 20 * 1e8
      });
      var address = '3NbU8XzUgKyuCgYgZEKsBtUvkTm2r7Xgwj';
      var options = {};
      bitcoind.getAddressSummary(address, options, function(err, summary) {
        summary.appearances.should.equal(3);
        summary.totalReceived.should.equal(3000000000);
        summary.totalSpent.should.equal(1000000000);
        summary.balance.should.equal(2000000000);
        summary.unconfirmedAppearances.should.equal(2);
        summary.unconfirmedBalance.should.equal(-900001);
        summary.txids.should.deep.equal([
          'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce',
          'b1bfa8dbbde790cb46b9763ef3407c1a21c8264b67bfe224f462ec0e1f569e92',
          '70d9d441d7409aace8e0ffe24ff0190407b2fcb405799a266e0327017288d1f8',
          '35fafaf572341798b2ce2858755afa7c8800bb6b1e885d3e030b81255b5e172d',
          '57b7842afc97a2b46575b490839df46e9273524c6ea59ba62e1e86477cf25247'
        ]);
        done();
      });
    });
    it('will get from cache with noTxList', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getAddressMempool: sinon.stub().callsArgWith(1, null, {
            result: [
              {
                txid: memtxid1,
                satoshis: -1000000
              },
              {
                txid: memtxid2,
                satoshis: 99999
              }
            ]
          })
        }
      });
      bitcoind.getAddressTxids = sinon.stub().callsArgWith(2, null, [txid1, txid2, txid3]);
      bitcoind.getAddressBalance = sinon.stub().callsArgWith(2, null, {
        received: 30 * 1e8,
        balance: 20 * 1e8
      });
      var address = '3NbU8XzUgKyuCgYgZEKsBtUvkTm2r7Xgwj';
      var options = {
        noTxList: true
      };
      function checkSummary(summary) {
        summary.appearances.should.equal(3);
        summary.totalReceived.should.equal(3000000000);
        summary.totalSpent.should.equal(1000000000);
        summary.balance.should.equal(2000000000);
        summary.unconfirmedAppearances.should.equal(2);
        summary.unconfirmedBalance.should.equal(-900001);
        should.not.exist(summary.txids);
      }
      bitcoind.getAddressSummary(address, options, function(err, summary) {
        checkSummary(summary);
        bitcoind.getAddressTxids.callCount.should.equal(1);
        bitcoind.getAddressBalance.callCount.should.equal(1);
        bitcoind.getAddressSummary(address, options, function(err, summary) {
          checkSummary(summary);
          bitcoind.getAddressTxids.callCount.should.equal(1);
          bitcoind.getAddressBalance.callCount.should.equal(1);
          done();
        });
      });
    });
  });

  describe('#getRawBlock', function() {
    var blockhash = '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b';
    var blockhex = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
    it('will give rcp error from client getblockhash', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getBlockHash: sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'})
        }
      });
      bitcoind.getRawBlock(10, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
        done();
      });
    });
    it('will give rcp error from client getblock', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getBlock: sinon.stub().callsArgWith(2, {code: -1, message: 'Test error'})
        }
      });
      bitcoind.getRawBlock(blockhash, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
        done();
      });
    });
    it('will try all nodes for getblock', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlockWithError = sinon.stub().callsArgWith(2, {code: -1, message: 'Test error'});
      bitcoind.tryAllInterval = 1;
      bitcoind.nodes.push({
        client: {
          getBlock: getBlockWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getBlock: getBlockWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getBlock: sinon.stub().callsArgWith(2, null, {
            result: blockhex
          })
        }
      });
      bitcoind.getRawBlock(blockhash, function(err, buffer) {
        if (err) {
          return done(err);
        }
        buffer.should.be.instanceof(Buffer);
        getBlockWithError.callCount.should.equal(2);
        done();
      });
    });
    it('will get block from cache', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock
        }
      });
      bitcoind.getRawBlock(blockhash, function(err, buffer) {
        if (err) {
          return done(err);
        }
        buffer.should.be.instanceof(Buffer);
        getBlock.callCount.should.equal(1);
        bitcoind.getRawBlock(blockhash, function(err, buffer) {
          if (err) {
            return done(err);
          }
          buffer.should.be.instanceof(Buffer);
          getBlock.callCount.should.equal(1);
          done();
        });
      });
    });
    it('will get block by height', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      var getBlockHash = sinon.stub().callsArgWith(1, null, {
        result: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
      });
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getRawBlock(0, function(err, buffer) {
        if (err) {
          return done(err);
        }
        buffer.should.be.instanceof(Buffer);
        getBlock.callCount.should.equal(1);
        getBlockHash.callCount.should.equal(1);
        done();
      });
    });
  });

  describe('#getBlock', function() {
    var blockhex = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
    it('will give an rpc error from client getblock', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, {code: -1, message: 'Test error'});
      var getBlockHash = sinon.stub().callsArgWith(1, null, {});
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getBlock(0, function(err) {
        err.should.be.instanceof(Error);
        done();
      });
    });
    it('will give an rpc error from client getblockhash', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlockHash = sinon.stub().callsArgWith(1, {code: -1, message: 'Test error'});
      bitcoind.nodes.push({
        client: {
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getBlock(0, function(err) {
        err.should.be.instanceof(Error);
        done();
      });
    });
    it('will getblock as bitcore object from height', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      var getBlockHash = sinon.stub().callsArgWith(1, null, {
        result: '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b'
      });
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getBlock(0, function(err, block) {
        should.not.exist(err);
        getBlock.args[0][0].should.equal('00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b');
        getBlock.args[0][1].should.equal(false);
        block.should.be.instanceof(bitcore.Block);
        done();
      });
    });
    it('will getblock as bitcore object', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      var getBlockHash = sinon.stub();
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getBlock('00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b', function(err, block) {
        should.not.exist(err);
        getBlockHash.callCount.should.equal(0);
        getBlock.callCount.should.equal(1);
        getBlock.args[0][0].should.equal('00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b');
        getBlock.args[0][1].should.equal(false);
        block.should.be.instanceof(bitcore.Block);
        done();
      });
    });
    it('will get block from cache', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      var getBlockHash = sinon.stub();
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      var hash = '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b';
      bitcoind.getBlock(hash, function(err, block) {
        should.not.exist(err);
        getBlockHash.callCount.should.equal(0);
        getBlock.callCount.should.equal(1);
        block.should.be.instanceof(bitcore.Block);
        bitcoind.getBlock(hash, function(err, block) {
          should.not.exist(err);
          getBlockHash.callCount.should.equal(0);
          getBlock.callCount.should.equal(1);
          block.should.be.instanceof(bitcore.Block);
          done();
        });
      });
    });
    it('will get block from cache with height (but not height)', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlock = sinon.stub().callsArgWith(2, null, {
        result: blockhex
      });
      var getBlockHash = sinon.stub().callsArgWith(1, null, {
        result: '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b'
      });
      bitcoind.nodes.push({
        client: {
          getBlock: getBlock,
          getBlockHash: getBlockHash
        }
      });
      bitcoind.getBlock(0, function(err, block) {
        should.not.exist(err);
        getBlockHash.callCount.should.equal(1);
        getBlock.callCount.should.equal(1);
        block.should.be.instanceof(bitcore.Block);
        bitcoind.getBlock(0, function(err, block) {
          should.not.exist(err);
          getBlockHash.callCount.should.equal(2);
          getBlock.callCount.should.equal(1);
          block.should.be.instanceof(bitcore.Block);
          done();
        });
      });
    });
  });

  describe('#getBlockHashesByTimestamp', function() {
    it('should give an rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBlockHashes = sinon.stub().callsArgWith(2, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getBlockHashes: getBlockHashes
        }
      });
      bitcoind.getBlockHashesByTimestamp(1441911000, 1441914000, function(err, hashes) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
    it('should get the correct block hashes', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var block1 = '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b';
      var block2 = '000000000383752a55a0b2891ce018fd0fdc0b6352502772b034ec282b4a1bf6';
      var getBlockHashes = sinon.stub().callsArgWith(2, null, {
        result: [block2, block1]
      });
      bitcoind.nodes.push({
        client: {
          getBlockHashes: getBlockHashes
        }
      });
      bitcoind.getBlockHashesByTimestamp(1441914000, 1441911000, function(err, hashes) {
        should.not.exist(err);
        hashes.should.deep.equal([block2, block1]);
        done();
      });
    });
  });

  describe('#getBlockHeader', function() {
  });

  describe('#estimateFee', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var estimateFee = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          estimateFee: estimateFee
        }
      });
      bitcoind.estimateFee(1, function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will call client estimateFee and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var estimateFee = sinon.stub().callsArgWith(1, null, {
        result: -1
      });
      bitcoind.nodes.push({
        client: {
          estimateFee: estimateFee
        }
      });
      bitcoind.estimateFee(1, function(err, feesPerKb) {
        if (err) {
          return done(err);
        }
        feesPerKb.should.equal(-1);
        done();
      });
    });
  });

  describe('#sendTransaction', function(done) {
    var tx = bitcore.Transaction(txhex);
    it('will give rpc error', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var sendRawTransaction = sinon.stub().callsArgWith(2, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          sendRawTransaction: sendRawTransaction
        }
      });
      bitcoind.sendTransaction(txhex, function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
      });
    });
    it('will send to client and get hash', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var sendRawTransaction = sinon.stub().callsArgWith(2, null, {
        result: tx.hash
      });
      bitcoind.nodes.push({
        client: {
          sendRawTransaction: sendRawTransaction
        }
      });
      bitcoind.sendTransaction(txhex, function(err, hash) {
        if (err) {
          return done(err);
        }
        hash.should.equal(tx.hash);
      });
    });
    it('will send to client with absurd fees and get hash', function() {
      var bitcoind = new BitcoinService(baseConfig);
      var sendRawTransaction = sinon.stub().callsArgWith(2, null, {
        result: tx.hash
      });
      bitcoind.nodes.push({
        client: {
          sendRawTransaction: sendRawTransaction
        }
      });
      bitcoind.sendTransaction(txhex, {allowAbsurdFees: true}, function(err, hash) {
        if (err) {
          return done(err);
        }
        hash.should.equal(tx.hash);
      });
    });
  });

  describe('#getRawTransaction', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getRawTransaction = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getRawTransaction('txid', function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will try all nodes', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.tryAllInterval = 1;
      var getRawTransactionWithError = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      var getRawTransaction = sinon.stub().callsArgWith(1, null, {
        result: txhex
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransactionWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransactionWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getRawTransaction('txid', function(err, tx) {
        if (err) {
          return done(err);
        }
        should.exist(tx);
        tx.should.be.an.instanceof(Buffer);
        done();
      });
    });
    it('will get from cache', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getRawTransaction = sinon.stub().callsArgWith(1, null, {
        result: txhex
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getRawTransaction('txid', function(err, tx) {
        if (err) {
          return done(err);
        }
        should.exist(tx);
        tx.should.be.an.instanceof(Buffer);

        bitcoind.getRawTransaction('txid', function(err, tx) {
          should.exist(tx);
          tx.should.be.an.instanceof(Buffer);
          getRawTransaction.callCount.should.equal(1);
          done();
        });
      });
    });
  });

  describe('#getTransaction', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getRawTransaction = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getTransaction('txid', function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will try all nodes', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.tryAllInterval = 1;
      var getRawTransactionWithError = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      var getRawTransaction = sinon.stub().callsArgWith(1, null, {
        result: txhex
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransactionWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransactionWithError
        }
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getTransaction('txid', function(err, tx) {
        if (err) {
          return done(err);
        }
        should.exist(tx);
        tx.should.be.an.instanceof(bitcore.Transaction);
        done();
      });
    });
    it('will get from cache', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getRawTransaction = sinon.stub().callsArgWith(1, null, {
        result: txhex
      });
      bitcoind.nodes.push({
        client: {
          getRawTransaction: getRawTransaction
        }
      });
      bitcoind.getTransaction('txid', function(err, tx) {
        if (err) {
          return done(err);
        }
        should.exist(tx);
        tx.should.be.an.instanceof(bitcore.Transaction);

        bitcoind.getTransaction('txid', function(err, tx) {
          should.exist(tx);
          tx.should.be.an.instanceof(bitcore.Transaction);
          getRawTransaction.callCount.should.equal(1);
          done();
        });

      });
    });
  });

  describe('#getTransactionWithBlockInfo', function() {
    var txBuffer = new Buffer('01000000016f95980911e01c2c664b3e78299527a47933aac61a515930a8fe0213d1ac9abe01000000da0047304402200e71cda1f71e087c018759ba3427eb968a9ea0b1decd24147f91544629b17b4f0220555ee111ed0fc0f751ffebf097bdf40da0154466eb044e72b6b3dcd5f06807fa01483045022100c86d6c8b417bff6cc3bbf4854c16bba0aaca957e8f73e19f37216e2b06bb7bf802205a37be2f57a83a1b5a8cc511dc61466c11e9ba053c363302e7b99674be6a49fc0147522102632178d046673c9729d828cfee388e121f497707f810c131e0d3fc0fe0bd66d62103a0951ec7d3a9da9de171617026442fcd30f34d66100fab539853b43f508787d452aeffffffff0240420f000000000017a9148a31d53a448c18996e81ce67811e5fb7da21e4468738c9d6f90000000017a9148ce5408cfeaddb7ccb2545ded41ef478109454848700000000', 'hex');
    var info = {
      blockHash: '00000000000ec715852ea2ecae4dc8563f62d603c820f81ac284cd5be0a944d6',
      height: 530482,
      timestamp: 1439559434000,
      buffer: txBuffer
    };

    it('should give a transaction with height and timestamp', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getRawTransaction: sinon.stub().callsArgWith(2, {code: -1, message: 'Test error'})
        }
      });
      var txid = '2d950d00494caf6bfc5fff2a3f839f0eb50f663ae85ce092bc5f9d45296ae91f';
      bitcoind.getTransactionWithBlockInfo(txid, function(err) {
        should.exist(err);
        err.should.be.instanceof(errors.RPCError);
        done();
      });
    });
    it('should give a transaction with height and timestamp', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.nodes.push({
        client: {
          getRawTransaction: sinon.stub().callsArgWith(2, null, {
            result: {
              hex: txBuffer.toString('hex'),
              blockhash: info.blockHash,
              height: info.height,
              time: info.timestamp,
              vout: [
                {
                  spentTxId: 'txid',
                  spentIndex: 2,
                  spentHeight: 100
                }
              ]
            }
          })
        }
      });
      var txid = '2d950d00494caf6bfc5fff2a3f839f0eb50f663ae85ce092bc5f9d45296ae91f';
      bitcoind.getTransactionWithBlockInfo(txid, function(err, tx) {
        // TODO verify additional info
        should.exist(tx);
        done();
      });
    });
  });

  describe('#getBestBlockHash', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBestBlockHash = sinon.stub().callsArgWith(0, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getBestBlockHash: getBestBlockHash
        }
      });
      bitcoind.getBestBlockHash(function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will call client getInfo and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getBestBlockHash = sinon.stub().callsArgWith(0, null, {
        result: 'besthash'
      });
      bitcoind.nodes.push({
        client: {
          getBestBlockHash: getBestBlockHash
        }
      });
      bitcoind.getBestBlockHash(function(err, hash) {
        if (err) {
          return done(err);
        }
        should.exist(hash);
        hash.should.equal('besthash');
        done();
      });
    });
  });

  describe('#getSpentInfo', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getSpentInfo = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getSpentInfo: getSpentInfo
        }
      });
      bitcoind.getSpentInfo({}, function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will empty object when not found', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getSpentInfo = sinon.stub().callsArgWith(1, {message: 'test', code: -5});
      bitcoind.nodes.push({
        client: {
          getSpentInfo: getSpentInfo
        }
      });
      bitcoind.getSpentInfo({}, function(err, info) {
        should.not.exist(err);
        info.should.deep.equal({});
        done();
      });
    });
    it('will call client getSpentInfo and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getSpentInfo = sinon.stub().callsArgWith(1, null, {
        result: {
          txid: 'txid',
          index: 10,
          height: 101
        }
      });
      bitcoind.nodes.push({
        client: {
          getSpentInfo: getSpentInfo
        }
      });
      bitcoind.getSpentInfo({}, function(err, info) {
        if (err) {
          return done(err);
        }
        info.txid.should.equal('txid');
        info.index.should.equal(10);
        info.height.should.equal(101);
        done();
      });
    });
  });

  describe('#getInfo', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var getInfo = sinon.stub().callsArgWith(0, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          getInfo: getInfo
        }
      });
      bitcoind.getInfo(function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will call client getInfo and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.node.getNetworkName = sinon.stub().returns('testnet');
      var getInfo = sinon.stub().callsArgWith(0, null, {
        result: {}
      });
      bitcoind.nodes.push({
        client: {
          getInfo: getInfo
        }
      });
      bitcoind.getInfo(function(err, info) {
        if (err) {
          return done(err);
        }
        should.exist(info);
        should.exist(info.network);
        info.network.should.equal('testnet');
        done();
      });
    });
  });

  describe('#generateBlock', function() {
    it('will give rpc error', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var generate = sinon.stub().callsArgWith(1, {message: 'error', code: -1});
      bitcoind.nodes.push({
        client: {
          generate: generate
        }
      });
      bitcoind.generateBlock(10, function(err) {
        should.exist(err);
        err.should.be.an.instanceof(errors.RPCError);
        done();
      });
    });
    it('will call client generate and give result', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      var generate = sinon.stub().callsArgWith(1, null, {
        result: ['hash']
      });
      bitcoind.nodes.push({
        client: {
          generate: generate
        }
      });
      bitcoind.generateBlock(10, function(err, hashes) {
        if (err) {
          return done(err);
        }
        hashes.length.should.equal(1);
        hashes[0].should.equal('hash');
        done();
      });
    });
  });

  describe('#stop', function() {
    it('will callback if spawn is not set', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.stop(done);
    });
    it('will exit spawned process', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.spawn = {};
      bitcoind.spawn.process = new EventEmitter();
      bitcoind.spawn.process.kill = sinon.stub();
      bitcoind.stop(done);
      bitcoind.spawn.process.kill.callCount.should.equal(1);
      bitcoind.spawn.process.kill.args[0][0].should.equal('SIGINT');
      bitcoind.spawn.process.emit('exit', 0);
    });
    it('will give error with non-zero exit status code', function(done) {
      var bitcoind = new BitcoinService(baseConfig);
      bitcoind.spawn = {};
      bitcoind.spawn.process = new EventEmitter();
      bitcoind.spawn.process.kill = sinon.stub();
      bitcoind.stop(function(err) {
        err.should.be.instanceof(Error);
        err.code.should.equal(1);
        done();
      });
      bitcoind.spawn.process.kill.callCount.should.equal(1);
      bitcoind.spawn.process.kill.args[0][0].should.equal('SIGINT');
      bitcoind.spawn.process.emit('exit', 1);
    });
  });

});
