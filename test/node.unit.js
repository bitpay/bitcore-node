'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var EventEmitter = require('events').EventEmitter;
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var BufferUtil = bitcore.util.buffer;
var Block = bitcore.Block;
var blockData = require('./data/livenet-345003.json');
var proxyquire = require('proxyquire');
var index = require('..');
var fs = require('fs');
var chainHashes = require('./data/hashes.json');
var util = require('util');
var BaseModule = require('../lib/module');

describe('Bitcore Node', function() {

  var baseConfig = {
    datadir: 'testdir'
  };

  var Node;

  function hexlebuf(hexString){
    return BufferUtil.reverse(new Buffer(hexString, 'hex'));
  }

  function lebufhex(buf) {
    return BufferUtil.reverse(buf).toString('hex');
  }

  before(function() {
    Node = proxyquire('../lib/node', {});
    Node.prototype._loadConfiguration = sinon.spy();
    Node.prototype._initialize = sinon.spy();
  });

  describe('@constructor', function() {
    it('will set properties', function() {
      function TestModule() {}
      util.inherits(TestModule, BaseModule);
      TestModule.prototype.getData = function() {};
      TestModule.prototype.getAPIMethods = function() {
        return [
          ['getData', this, this.getData, 1]
        ];
      };
      var config = {
        datadir: 'testdir',
        modules: [
          {
            name: 'test1',
            module: TestModule
          }
        ],
      };
      var TestNode = proxyquire('../lib/node', {});
      TestNode.prototype._loadConfiguration = sinon.spy();
      TestNode.prototype._initialize = sinon.spy();
      var node = new TestNode(config);
      TestNode.prototype._loadConfiguration.callCount.should.equal(1);
      TestNode.prototype._initialize.callCount.should.equal(1);
      node._unloadedModules.length.should.equal(1);
      node._unloadedModules[0].name.should.equal('test1');
      node._unloadedModules[0].module.should.equal(TestModule);
    });
  });

  describe('#openBus', function() {
    it('will create a new bus', function() {
      var node = new Node(baseConfig);
      var bus = node.openBus();
      bus.node.should.equal(node);
    });
  });

  describe('#addModule', function() {
    it('will instantiate an instance and load api methods', function() {
      var node = new Node(baseConfig);
      function TestModule() {}
      util.inherits(TestModule, BaseModule);
      TestModule.prototype.getData = function() {};
      TestModule.prototype.getAPIMethods = function() {
        return [
          ['getData', this, this.getData, 1]
        ];
      };
      var service = {
        name: 'testmodule',
        module: TestModule
      };
      node.addModule(service);
      should.exist(node.modules.testmodule);
      should.exist(node.getData);
    });
  });

  describe('#getAllAPIMethods', function() {
    it('should return db methods and modules methods', function() {
      var node = new Node(baseConfig);
      node.modules = {
        module1: {
          getAPIMethods: sinon.stub().returns(['mda1', 'mda2'])
        },
        module2: {
          getAPIMethods: sinon.stub().returns(['mdb1', 'mdb2'])
        }
      };
      var db = {
        getAPIMethods: sinon.stub().returns(['db1', 'db2']),
      };
      node.db = db;

      var methods = node.getAllAPIMethods();
      methods.should.deep.equal(['db1', 'db2', 'mda1', 'mda2', 'mdb1', 'mdb2']);
    });
  });
  describe('#getAllPublishEvents', function() {
    it('should return modules publish events', function() {
      var node = new Node(baseConfig);
      node.modules = {
        module1: {
          getPublishEvents: sinon.stub().returns(['mda1', 'mda2'])
        },
        module2: {
          getPublishEvents: sinon.stub().returns(['mdb1', 'mdb2'])
        }
      };
      var db = {
        getPublishEvents: sinon.stub().returns(['db1', 'db2']),
      };
      node.db = db;

      var events = node.getAllPublishEvents();
      events.should.deep.equal(['db1', 'db2', 'mda1', 'mda2', 'mdb1', 'mdb2']);
    });
  });
  describe('#_loadConfiguration', function() {
    it('should call the necessary methods', function() {
      var TestNode = proxyquire('../lib/node', {});
      TestNode.prototype._initialize = sinon.spy();
      TestNode.prototype._loadDB = sinon.spy();
      TestNode.prototype._loadAPI = sinon.spy();
      TestNode.prototype._loadConsensus = sinon.spy();
      var node = new TestNode(baseConfig);
      node._loadDB.callCount.should.equal(1);
      node._loadAPI.callCount.should.equal(1);
      node._loadConsensus.callCount.should.equal(1);
    });
  });
  describe('#_syncBitcoindAncestor', function() {
    it('will find an ancestor 6 deep', function() {
      var node = new Node(baseConfig);
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
          header: {
            prevHash: hexlebuf('76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a')
          }
        },
        '76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a': {
          header: {
            prevHash: hexlebuf('f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c')
          }
        },
        'f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c': {
          header: {
            prevHash: hexlebuf('2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31')
          }
        },
        '2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31': {
          header: {
            prevHash: hexlebuf('adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453')
          }
        },
        'adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453': {
          header: {
            prevHash: hexlebuf('3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618')
          }
        },
        '3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618': {
          header: {
            prevHash: hexlebuf(expectedAncestor)
          }
        },
      };
      node.modules = {};
      node.modules.bitcoind = {
        getBlockIndex: function(hash) {
          var block = forkedBlocks[hash];
          return {
            prevHash: BufferUtil.reverse(block.header.prevHash).toString('hex')
          };
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
      var node = new Node(baseConfig);
      var ancestorHash = chainHashes[chainHashes.length - 6];
      node.chain = {
        tip: {
          __height: 10,
          hash: chainHashes[chainHashes.length],
          header: {
            prevHash: hexlebuf(chainHashes[chainHashes.length - 1])
          }
        },
        saveMetadata: sinon.stub(),
        emit: sinon.stub()
      };
      node.getBlock = function(hash, callback) {
        setImmediate(function() {
          for(var i = chainHashes.length; i > 0; i--) {
            var block = {
              hash: chainHashes[i],
              header: {
                prevHash: hexlebuf(chainHashes[i - 1])
              }
            };
            if (chainHashes[i] === hash) {
              callback(null, block);
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
      var node = new Node(baseConfig);
      var blockBuffer = new Buffer(blockData, 'hex');
      var block = Block.fromBuffer(blockBuffer);
      node.modules = {};
      node.modules.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer),
        isSynced: sinon.stub().returns(true),
        height: 1
      };
      node.chain = {
        tip: {
          __height: 0,
          hash: lebufhex(block.header.prevHash)
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
      var node = new Node(baseConfig);
      node.modules = {};
      node.modules.bitcoind = {
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
      var node = new Node(baseConfig);
      var blockBuffer = new Buffer(blockData, 'hex');
      var block = Block.fromBuffer(blockBuffer);
      node.modules = {};
      node.modules.bitcoind = {
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
        datadir: 'testdir',
        network: 'testnet'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('testnet');
    });
    it('should use the regtest network if regtest is specified', function() {
      var config = {
        datadir: 'testdir',
        network: 'regtest'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('regtest');
    });
    it('should use the livenet network if nothing is specified', function() {
      var config = {
        datadir: 'testdir'
      };
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

    var node;

    before(function() {
      node = new Node(baseConfig);
    });

    it('will set properties', function() {
      node._loadConsensus();
      should.exist(node.chain);
    });

  });

  describe('#_initialize', function() {

    var node;

    before(function() {
      var TestNode = proxyquire('../lib/node', {});
      TestNode.prototype._loadConfiguration = sinon.spy();
      TestNode.prototype._initializeBitcoind = sinon.spy();
      TestNode.prototype._initializeDatabase = sinon.spy();
      TestNode.prototype._initializeChain = sinon.spy();

      // mock the _initialize during construction
      var _initialize = TestNode.prototype._initialize;
      TestNode.prototype._initialize = sinon.spy();

      node = new TestNode(baseConfig);
      node.chain = {
        on: sinon.spy()
      };
      node.Block = 'Block';
      node.bitcoind = {
        on: sinon.spy()
      };
      node.db = {
        on: sinon.spy()
      };

      // restore the original method
      node._initialize = _initialize;
    });

    it('should initialize', function(done) {
      node.once('ready', function() {
        done();
      });

      node.start = sinon.stub().callsArg(0);

      node._initialize();

      // event handlers
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

  describe('#_initializeDatabase', function() {
    it('will log on ready event', function(done) {
      var node = new Node(baseConfig);
      node.db = new EventEmitter();
      sinon.stub(index.log, 'info');
      node.db.on('ready', function() {
        setImmediate(function() {
          index.log.info.callCount.should.equal(1);
          index.log.info.restore();
          done();
        });
      });
      node._initializeDatabase();
      node.db.emit('ready');
    });
    it('will call emit an error from db', function(done) {
      var node = new Node(baseConfig);
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

    it('will call sync when there is a new tip', function(done) {
      var node = new Node(baseConfig);
      node.chain = new EventEmitter();
      node.modules = {};
      node.modules.bitcoind = new EventEmitter();
      node.modules.bitcoind.syncPercentage = sinon.spy();
      node._syncBitcoind = function() {
        node.modules.bitcoind.syncPercentage.callCount.should.equal(1);
        done();
      };
      node._initializeChain();
      node.chain.emit('ready');
      node.modules.bitcoind.emit('tip', 10);
    });
    it('will not call sync when there is a new tip and shutting down', function(done) {
      var node = new Node(baseConfig);
      node.chain = new EventEmitter();
      node.modules = {};
      node.modules.bitcoind = new EventEmitter();
      node._syncBitcoind = sinon.spy();
      node.modules.bitcoind.syncPercentage = sinon.spy();
      node.stopping = true;
      node.modules.bitcoind.on('tip', function() {
        setImmediate(function() {
          node.modules.bitcoind.syncPercentage.callCount.should.equal(0);
          node._syncBitcoind.callCount.should.equal(0);
          done();
        });
      });
      node._initializeChain();
      node.chain.emit('ready');
      node.modules.bitcoind.emit('tip', 10);
    });
    it('will emit an error from the chain', function(done) {
      var node = new Node(baseConfig);
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
      var node = new Node(baseConfig);
      node.getServices = function() {
        return [
          {
            name: 'chain',
            dependencies: ['db']
          },
          {
            name: 'db',
            dependencies: ['daemon', 'p2p']
          },
          {
            name:'daemon',
            dependencies: []
          },
          {
            name: 'p2p',
            dependencies: []
          }
        ];
      };
      var order = node.getServiceOrder();
      order[0].name.should.equal('daemon');
      order[1].name.should.equal('p2p');
      order[2].name.should.equal('db');
      order[3].name.should.equal('chain');
    });
  });

  describe('#start', function() {
    it('will call start for each module', function(done) {
      var node = new Node(baseConfig);
      function TestModule() {}
      util.inherits(TestModule, BaseModule);
      TestModule.prototype.start = sinon.stub().callsArg(0);
      TestModule.prototype.getData = function() {};
      TestModule.prototype.getAPIMethods = function() {
        return [
          ['getData', this, this.getData, 1]
        ];
      };
      node.test2 = {};
      node.test2.start = sinon.stub().callsArg(0);
      node.getServiceOrder = sinon.stub().returns([
        {
          name: 'test1',
          module: TestModule
        },
        {
          name: 'test2'
        }
      ]);
      node.start(function() {
        node.test2.start.callCount.should.equal(1);
        TestModule.prototype.start.callCount.should.equal(1);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('will call stop for each module', function(done) {
      var node = new Node(baseConfig);
      function TestModule() {}
      util.inherits(TestModule, BaseModule);
      TestModule.prototype.stop = sinon.stub().callsArg(0);
      TestModule.prototype.getData = function() {};
      TestModule.prototype.getAPIMethods = function() {
        return [
          ['getData', this, this.getData, 1]
        ];
      };
      node.modules = {
        'test1': new TestModule({node: node})
      };
      node.test2 = {};
      node.test2.stop = sinon.stub().callsArg(0);
      node.getServiceOrder = sinon.stub().returns([
        {
          name: 'test2'
        },
        {
          name: 'test1',
          module: TestModule
        }
      ]);
      node.stop(function() {
        node.test2.stop.callCount.should.equal(1);
        TestModule.prototype.stop.callCount.should.equal(1);
        done();
      });
    });
  });

});
