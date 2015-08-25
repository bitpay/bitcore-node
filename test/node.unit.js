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
var fs = require('fs');
var bitcoinConfBuffer = fs.readFileSync(__dirname + '/data/bitcoin.conf');
var chainHashes = require('./data/hashes.json');

var BaseNode = function() {};
util.inherits(BaseNode, EventEmitter);
BaseNode.log = chainlib.log;
BaseNode.prototype._loadConfiguration = sinon.spy();
BaseNode.prototype._initialize = sinon.spy();
chainlib.Node = BaseNode;

var BadNode = proxyquire('../lib/node', {
  chainlib: chainlib,
  fs: {
    readFileSync: sinon.stub().returns(fs.readFileSync(__dirname + '/data/badbitcoin.conf'))
  }
});

var Node = proxyquire('../lib/node', {
  chainlib: chainlib,
  fs: {
    readFileSync: sinon.stub().returns(bitcoinConfBuffer)
  }
});
chainlib.Node = OriginalNode;

describe('Bitcoind Node', function() {
  describe('#openBus', function() {
    it('will create a new bus', function() {
      var node = new Node({});
      var db = {};
      node.db = db;
      var bus = node.openBus();
      bus.db.should.equal(db);
    });
  });
  describe('#getAllAPIMethods', function() {
    it('should return db methods and modules methods', function() {
      var node = new Node({});
      var db = {
        getAPIMethods: sinon.stub().returns(['db1', 'db2']),
        modules: [
          {
            getAPIMethods: sinon.stub().returns(['mda1', 'mda2'])
          },
          {
            getAPIMethods: sinon.stub().returns(['mdb1', 'mdb2'])
          }
        ]
      };
      node.db = db;

      var methods = node.getAllAPIMethods();
      methods.should.deep.equal(['db1', 'db2', 'mda1', 'mda2', 'mdb1', 'mdb2']);
    });
  });
  describe('#getAllPublishEvents', function() {
    it('should return modules publish events', function() {
      var node = new Node({});
      var db = {
        getPublishEvents: sinon.stub().returns(['db1', 'db2']),
        modules: [
          {
            getPublishEvents: sinon.stub().returns(['mda1', 'mda2'])
          },
          {
            getPublishEvents: sinon.stub().returns(['mdb1', 'mdb2'])
          }
        ]
      };
      node.db = db;

      var events = node.getAllPublishEvents();
      events.should.deep.equal(['db1', 'db2', 'mda1', 'mda2', 'mdb1', 'mdb2']);
    });
  });
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
  describe('#_loadBitcoinConf', function() {
    it('will parse a bitcoin.conf file', function() {
      var node = new Node({});
      node._loadBitcoinConf({datadir: process.env.HOME + '/.bitcoin'});
      should.exist(node.bitcoinConfiguration);
      node.bitcoinConfiguration.should.deep.equal({
        server: 1,
        whitelist: '127.0.0.1',
        txindex: 1,
        port: 20000,
        rpcallowip: '127.0.0.1',
        rpcuser: 'bitcoin',
        rpcpassword: 'local321'
      });
    });
  });
  describe('#_loadBitcoind', function() {
    it('should initialize', function() {
      var node = new Node({});
      node._loadBitcoind({datadir: './test'});
      should.exist(node.bitcoind);
    });
    it('should initialize with testnet', function() {
      var node = new Node({});
      node._loadBitcoind({datadir: './test', testnet: true});
      should.exist(node.bitcoind);
    });
    it('should throw an exception if txindex isn\'t enabled in the configuration', function() {
      var node = new BadNode({});
      (function() {
        node._loadBitcoinConf({datadir: './test'});
      }).should.throw('Txindex option');
    });
  });
  describe('#_syncBitcoindAncestor', function() {
    it('will find an ancestor 6 deep', function() {
      var node = new Node({});
      node.chain = {
        getHashes: function(tipHash, callback) {
          callback(null, chainHashes);
        },
        tip: {
          hash: chainHashes[chainHashes.length]
        }
      };
      var expectedAncestor = chainHashes[chainHashes.length - 6];
      var forkedBlocks = {
        'd7fa6f3d5b2fe35d711e6aca5530d311b8c6e45f588a65c642b8baf4b4441d82': {
          prevHash: '76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a'
        },
        '76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a': {
          prevHash: 'f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c'
        },
        'f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c': {
          prevHash: '2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31'
        },
        '2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31': {
          prevHash: 'adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453'
        },
        'adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453': {
          prevHash: '3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618'
        },
        '3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618': {
          prevHash: expectedAncestor
        },
      };
      node.bitcoind = {
        getBlockIndex: function(hash) {
          return forkedBlocks[hash];
        }
      };
      var block = forkedBlocks['d7fa6f3d5b2fe35d711e6aca5530d311b8c6e45f588a65c642b8baf4b4441d82'];
      node._syncBitcoindAncestor(block, function(err, ancestorHash) {
        if (err) {
          throw err;
        }
        ancestorHash.should.equal(expectedAncestor);
      });
    });
  });
  describe('#_syncBitcoindRewind', function() {
    it('will undo blocks 6 deep', function() {
      var node = new Node({});
      var ancestorHash = chainHashes[chainHashes.length - 6];
      node.chain = {
        tip: {
          __height: 10,
          hash: chainHashes[chainHashes.length],
          prevHash: chainHashes[chainHashes.length - 1]
        },
        saveMetadata: sinon.stub(),
        emit: sinon.stub()
      };
      node.getBlock = function(hash, callback) {
        setImmediate(function() {
          for(var i = chainHashes.length; i > 0; i--) {
            if (chainHashes[i] === hash) {
              callback(null, {
                hash: chainHashes[i],
                prevHash: chainHashes[i - 1]
              });
            }
          }
        });
      };
      node.db = {
        _onChainRemoveBlock: function(block, callback) {
          setImmediate(callback);
        }
      };
      node._syncBitcoindAncestor = function(block, callback) {
        setImmediate(function() {
          callback(null, ancestorHash);
        });
      };
      var forkedBlock = {};
      node._syncBitcoindRewind(forkedBlock, function(err) {
        if (err) {
          throw err;
        }
        node.chain.tip.__height.should.equal(4);
        node.chain.tip.hash.should.equal(ancestorHash);
      });
    });
  });
  describe('#_syncBitcoind', function() {
    it('will get and add block up to the tip height', function(done) {
      var node = new Node({});
      node.Block = Block;
      var blockBuffer = new Buffer(blockData);
      var block = Block.fromBuffer(blockBuffer);
      node.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer),
        isSynced: sinon.stub().returns(true),
        height: 1
      };
      node.chain = {
        tip: {
          __height: 0,
          hash: block.prevHash
        },
        getHashes: sinon.stub().callsArgWith(1, null),
        saveMetadata: sinon.stub(),
        emit: sinon.stub(),
        cache: {
          hashes: {}
        }
      };
      node.db = {
        _onChainAddBlock: function(block, callback) {
          node.chain.tip.__height += 1;
          callback();
        }
      };
      node.on('synced', function() {
        done();
      });
      node._syncBitcoind();
    });
    it('will exit and emit error with error from bitcoind.getBlock', function(done) {
      var node = new Node({});
      node.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, new Error('test error')),
        height: 1
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
    it('will stop syncing when the node is stopping', function(done) {
      var node = new Node({});
      node.Block = Block;
      var blockBuffer = new Buffer(blockData);
      var block = Block.fromBuffer(blockBuffer);
      node.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer),
        isSynced: sinon.stub().returns(true),
        height: 1
      };
      node.chain = {
        tip: {
          __height: 0,
          hash: block.prevHash
        },
        saveMetadata: sinon.stub(),
        emit: sinon.stub(),
        cache: {
          hashes: {}
        }
      };
      node.db = {
        _onChainAddBlock: function(block, callback) {
          node.chain.tip.__height += 1;
          callback();
        }
      };
      node.stopping = true;

      var synced = false;

      node.on('synced', function() {
        synced = true;
      });

      node._syncBitcoind();

      setTimeout(function() {
        synced.should.equal(false);
        done();
      }, 10);
    });
  });

  describe('#_loadNetwork', function() {
    it('should use the testnet network if testnet is specified', function() {
      var config = {
        network: 'testnet'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('testnet');
    });
    it('should use the regtest network if regtest is specified', function() {
      var config = {
        network: 'regtest'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('regtest');
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
        config.path.should.equal(process.env.HOME + '/.bitcoin/bitcore-node.db');
      };
      var config = {
        DB: DB,
        datadir: process.env.HOME + '/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.livenet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('should load the db for testnet', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/testnet3/bitcore-node.db');
      };
      var config = {
        DB: DB,
        datadir: process.env.HOME + '/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.testnet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('error with unknown network', function() {
      var config = {
        datadir: process.env.HOME + '/.bitcoin'
      };

      var node = new Node(config);
      node.network = 'not a network';
      (function() {
        node._loadDB(config);
      }).should.throw('Unknown network');
    });
    it('should load the db with regtest', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/regtest/bitcore-node.db');
      };
      var config = {
        DB: DB,
        datadir: process.env.HOME + '/.bitcoin'
      };

      var node = new Node(config);
      // Switch to use regtest
      Networks.remove(Networks.testnet);
      Networks.add({
        name: 'regtest',
        alias: 'regtest',
        pubkeyhash: 0x6f,
        privatekey: 0xef,
        scripthash: 0xc4,
        xpubkey: 0x043587cf,
        xprivkey: 0x04358394,
        networkMagic: 0xfabfb5da,
        port: 18444,
        dnsSeeds: [ ]
      });
      var regtest = Networks.get('regtest');
      node.network = regtest;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
      Networks.remove(regtest);
      // Add testnet back
      Networks.add({
        name: 'testnet',
        alias: 'testnet',
        pubkeyhash: 0x6f,
        privatekey: 0xef,
        scripthash: 0xc4,
        xpubkey: 0x043587cf,
        xprivkey: 0x04358394,
        networkMagic: 0x0b110907,
        port: 18333,
        dnsSeeds: [
          'testnet-seed.bitcoin.petertodd.org',
          'testnet-seed.bluematt.me',
          'testnet-seed.alexykot.me',
          'testnet-seed.bitcoin.schildbach.de'
        ]
      });
    });
  });
  describe('#_loadConsensus', function() {
    var node = new Node({});

    it('will set properties', function() {
      node._loadConsensus();
      should.exist(node.Block);
      should.exist(node.chain);
    });

  });

  describe('#_initialize', function() {

    var node;

    before(function() {
      node = new Node({});
      node.chain = {
        on: sinon.spy()
      };
      node.Block = 'Block';
      node.bitcoind = {
        on: sinon.spy()
      };
      node._initializeBitcoind = sinon.spy();
      node._initializeDatabase = sinon.spy();
      node._initializeChain = sinon.spy();
      node.db = {
        on: sinon.spy()
      };
    });

    it('should initialize', function(done) {
      node.once('ready', function() {
        done();
      });

      node.start = sinon.stub().callsArg(0);

      node._initialize();

      // references
      node.db.chain.should.equal(node.chain);
      node.db.Block.should.equal(node.Block);
      node.db.bitcoind.should.equal(node.bitcoind);
      node.chain.db.should.equal(node.db);
      node.chain.db.should.equal(node.db);

      // event handlers
      node._initializeBitcoind.callCount.should.equal(1);
      node._initializeDatabase.callCount.should.equal(1);
      node._initializeChain.callCount.should.equal(1);

    });

    it('should emit an error if an error occurred starting services', function(done) {
      node.once('error', function(err) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
      node.start = sinon.stub().callsArgWith(0, new Error('error'));
      node._initialize();
    });

  });

  describe('#_initalizeBitcoind', function() {

    it('will call emit an error from libbitcoind', function(done) {
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
    it('will call sync when there is a new tip', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node.bitcoind.syncPercentage = sinon.spy();
      node._syncBitcoind = function() {
        node.bitcoind.syncPercentage.callCount.should.equal(1);
        done();
      };
      node._initializeBitcoind();
      node.bitcoind.emit('tip', 10);
    });
    it('will not call sync when there is a new tip and shutting down', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node._syncBitcoind = sinon.spy();
      node.bitcoind.syncPercentage = sinon.spy();
      node.stopping = true;
      node.bitcoind.on('tip', function() {
        setImmediate(function() {
          node.bitcoind.syncPercentage.callCount.should.equal(0);
          node._syncBitcoind.callCount.should.equal(0);
          done();
        });
      });
      node._initializeBitcoind();
      node.bitcoind.emit('tip', 10);
    });
  });

  describe('#_initializeDatabase', function() {
    it('will log on ready event', function(done) {
      var node = new Node({});
      node.db = new EventEmitter();
      sinon.stub(chainlib.log, 'info');
      node.db.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
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
    it('will call _syncBitcoind on ready', function(done) {
      var node = new Node({});
      node._syncBitcoind = sinon.spy();
      node.chain = new EventEmitter();
      node.chain.on('ready', function(err) {
        setImmediate(function() {
          node._syncBitcoind.callCount.should.equal(1);
          done();
        });
      });
      node._initializeChain();
      node.chain.emit('ready');
    });
    it('will emit an error from the chain', function(done) {
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

  describe('#getServiceOrder', function() {
    it('should return the services in the correct order', function() {
      var node = new Node({});
      node.getServices = function() {
        return {
          'chain': ['db'],
          'db': ['daemon', 'p2p'],
          'daemon': [],
          'p2p': []
        };
      };
      var order = node.getServiceOrder();
      order.should.deep.equal(['daemon', 'p2p', 'db', 'chain']);
    });
  });
});
