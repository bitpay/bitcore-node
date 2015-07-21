'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var blockData = require('./data/livenet-345003.json');
var Block = require('../lib/block');
var proxyquire = require('proxyquire');
var chainlib = require('chainlib');
var OriginalNode = chainlib.Node;

var BaseNode = function() {};
util.inherits(BaseNode, EventEmitter);
BaseNode.log = chainlib.log;
BaseNode.prototype._loadConfiguration = sinon.spy();
BaseNode.prototype._initialize = sinon.spy();
chainlib.Node = BaseNode;

var Node = proxyquire('../lib/node', {chainlib: chainlib});
chainlib.Node = OriginalNode;

describe('Bitcoind Node', function() {
  describe('#_loadConfiguration', function() {
    it('should call the necessary methods', function() {
      var node = new Node({});
      node._loadBitcoinConf = sinon.spy();
      node._loadBitcoind = sinon.spy();
      node._loadConfiguration({});
      node._loadBitcoind.called.should.equal(true);
      node._loadBitcoinConf.called.should.equal(true);
      BaseNode.prototype._loadConfiguration.called.should.equal(true);
    });
  });
  describe('#setSyncStrategy', function() {
    it('will call p2p.startSync', function() {
      var node = new Node({});
      node.p2p = {
        startSync: sinon.spy()
      };
      node.setSyncStrategy(Node.SYNC_STRATEGIES.P2P);
      node.p2p.startSync.callCount.should.equal(1);
    });
    it('will call this._syncBitcoind and disable p2p sync', function() {
      var node = new Node({});
      node.p2p = {};
      node._syncBitcoind = sinon.spy();
      node.setSyncStrategy(Node.SYNC_STRATEGIES.BITCOIND);
      node._syncBitcoind.callCount.should.equal(1);
      node.p2p.disableSync.should.equal(true);
    });
    it('will error with an unknown strategy', function() {
      var node = new Node({});
      (function(){
        node.setSyncStrategy('unknown');
      }).should.throw('Strategy "unknown" is unknown');
    });
  });
  describe('#_loadBitcoind', function() {
    it('should initialize', function() {
      var node = new Node({});
      node._loadBitcoind({});
      should.exist(node.bitcoind);
    });
    it('should initialize with testnet', function() {
      var node = new Node({});
      node._loadBitcoind({testnet: true});
      should.exist(node.bitcoind);
    });
  });
  describe('#_syncBitcoind', function() {
    it('will get and add block up to the tip height', function(done) {
      var node = new Node({});
      node.p2p = {
        synced: false
      };
      node.Block = Block;
      node.syncStrategy = Node.SYNC_STRATEGIES.BITCOIND;
      node.setSyncStrategy = sinon.stub();
      node.bitcoind = {
        getInfo: sinon.stub().returns({blocks: 2}),
        getBlock: sinon.stub().callsArgWith(1, null, new Buffer(blockData))
      };
      node.chain = {
        tip: {
          __height: 0
        },
        addBlock: function(block, callback) {
          node.chain.tip.__height += 1;
          callback();
        }
      };
      node.on('synced', function() {
        node.p2p.synced.should.equal(true);
        node.setSyncStrategy.callCount.should.equal(1);
        done();
      });
      node._syncBitcoind();
    });
    it('will exit and emit error with error from bitcoind.getBlock', function(done) {
      var node = new Node({});
      node.p2p = {
        synced: false
      };
      node.syncStrategy = Node.SYNC_STRATEGIES.BITCOIND;
      node.setSyncStrategy = sinon.stub();
      node.bitcoind = {
        getInfo: sinon.stub().returns({blocks: 2}),
        getBlock: sinon.stub().callsArgWith(1, new Error('test error'))
      };
      node.chain = {
        tip: {
          __height: 0
        }
      };
      node.on('error', function(err) {
        err.message.should.equal('test error');
        done();
      });
      node._syncBitcoind();
    });
    it('will exit if sync strategy is changed to bitcoind', function(done) {
      var node = new Node({});
      node.p2p = {
        synced: false
      };
      node.syncStrategy = Node.SYNC_STRATEGIES.P2P;
      node.setSyncStrategy = sinon.stub();
      node.bitcoind = {
        getInfo: sinon.stub().returns({blocks: 2})
      };
      node.chain = {
        tip: {
          __height: 0
        }
      };
      node.on('synced', function() {
        node.p2p.synced.should.equal(true);
        node.setSyncStrategy.callCount.should.equal(1);
        done();
      });
      node._syncBitcoind();
    });
  });
  describe('#_loadNetwork', function() {
    it('should add the network that was listed in the config', function() {
      var config = {
        network: {
          name: 'chainlib',
          alias: 'chainlib',
          pubkeyhash: 0x1c,
          privatekey: 0x1e,
          scripthash: 0x28,
          xpubkey: 0x02e8de8f,
          xprivkey: 0x02e8da54,
          networkMagic: 0x0c110907,
          port: 9333
        }
      };
      var node = new Node(config);
      node._loadNetwork(config);
      var network = Networks.get('chainlib');
      should.exist(network);
      node.network.name.should.equal('chainlib');
    });
    it('should use the testnet network if testnet is specified', function() {
      var config = {
        testnet: true
      };

      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('testnet');
    });
    it('should use the livenet network if nothing is specified', function() {
      var config = {};

      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('livenet');
    });
  });
  describe('#_loadDB', function() {
    it('should load the db', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/bitcoindjs.db');
      };
      var config = {
        DB: DB,
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.livenet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('should load the db for testnet', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/testnet3/bitcoindjs.db');
      };
      var config = {
        DB: DB,
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.testnet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('error with unknown network', function() {
      var config = {
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = 'not a network';
      (function() {
        node._loadDB(config);
      }).should.throw('Unknown network');
    });
  });
  describe('#_loadP2P', function() {
    it('should load p2p', function() {
      var config = {};

      var node = new Node(config);
      node.db = {
        Transaction: bitcore.Transaction
      };
      node.network = Networks.get('testnet');
      node._loadP2P(config);
      should.exist(node.p2p);
      node.p2p.noListen.should.equal(true);
      node.p2p.pool.network.should.deep.equal(node.network);
      node.db.Transaction.should.equal(bitcore.Transaction);
    });
  });
  describe('#_loadConsensus', function() {
    var node = new Node({});

    it('should use the genesis specified in the config', function() {
      var config = {
        genesis: '0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000'
      };
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206');
    });
    it('should use the testnet genesis if testnet is specified', function() {
      var config = {
        testnet: true
      };
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943');
    });
    it('should use the livenet genesis if nothing is specified', function() {
      var config = {};
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
    });
  });

  describe('#_initializeBitcoind', function() {
    it('will call db.initialize() on ready event', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node.db = {
        initialize: sinon.spy()
      };
      sinon.stub(chainlib.log, 'info');
      node.bitcoind.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
          node.db.initialize.callCount.should.equal(1);
          done();
        });
      });
      node._initializeBitcoind();
      node.bitcoind.emit('ready');
    });
    it('will call emit an error from bitcoind.js', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeBitcoind();
      node.bitcoind.emit('error', new Error('test error'));
    });
  });

  describe('#_initializeDatabase', function() {
    it('will call chain.initialize() on ready event', function(done) {
      var node = new Node({});
      node.db = new EventEmitter();
      node.chain = {
        initialize: sinon.spy()
      };
      sinon.stub(chainlib.log, 'info');
      node.db.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
          node.chain.initialize.callCount.should.equal(1);
          done();
        });
      });
      node._initializeDatabase();
      node.db.emit('ready');
    });
    it('will call emit an error from db', function(done) {
      var node = new Node({});
      node.db = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeDatabase();
      node.db.emit('error', new Error('test error'));
    });
  });

  describe('#_initializeChain', function() {
    it('will call p2p.initialize() on ready event', function(done) {
      var node = new Node({});
      node.chain = new EventEmitter();
      node.p2p = {
        initialize: sinon.spy()
      };
      sinon.stub(chainlib.log, 'info');
      node.chain.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
          node.p2p.initialize.callCount.should.equal(1);
          done();
        });
      });
      node._initializeChain();
      node.chain.emit('ready');
    });
    it('will call emit an error from chain', function(done) {
      var node = new Node({});
      node.chain = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeChain();
      node.chain.emit('error', new Error('test error'));
    });
  });

  describe('#_initializeP2P', function() {
    it('will emit node "ready" when p2p is ready', function(done) {
      var node = new Node({});
      node.p2p = new EventEmitter();
      sinon.stub(chainlib.log, 'info');
      node.on('ready', function() {
        chainlib.log.info.callCount.should.equal(1);
        chainlib.log.info.restore();
        done();
      });
      node._initializeP2P();
      node.p2p.emit('ready');
    });
    it('will call emit an error from p2p', function(done) {
      var node = new Node({});
      node.p2p = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeP2P();
      node.p2p.emit('error', new Error('test error'));
    });
    it('will relay synced event from p2p to node', function(done) {
      var node = new Node({});
      node.p2p = new EventEmitter();
      node.on('synced', function() {
        done();
      });
      node._initializeP2P();
      node.p2p.emit('synced');
    });
  });

  describe('#_initialize', function() {

    it('should initialize', function(done) {
      var node = new Node({});
      node.chain = {};
      node.Block = 'Block';
      node.bitcoind = 'bitcoind';
      node.p2p = {};
      node.db = {};

      node._initializeBitcoind = sinon.spy();
      node._initializeDatabase = sinon.spy();
      node._initializeChain = sinon.spy();
      node._initializeP2P = sinon.spy();
      node._initialize();

      // references
      node.db.chain.should.equal(node.chain);
      node.db.Block.should.equal(node.Block);
      node.db.bitcoind.should.equal(node.bitcoind);
      node.chain.db.should.equal(node.db);
      node.chain.p2p.should.equal(node.p2p);
      node.chain.db.should.equal(node.db);
      node.p2p.db.should.equal(node.db);
      node.p2p.chain.should.equal(node.chain);

      // events
      node._initializeBitcoind.callCount.should.equal(1);
      node._initializeDatabase.callCount.should.equal(1);
      node._initializeChain.callCount.should.equal(1);
      node._initializeP2P.callCount.should.equal(1);

      // start syncing
      node.setSyncStrategy = sinon.spy();
      node.on('ready', function() {
        node.setSyncStrategy.callCount.should.equal(1);
        done();
      });
      node.emit('ready');

    });

  });
});
