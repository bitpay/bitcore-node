'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var EventEmitter = require('events').EventEmitter;
var proxyquire = require('proxyquire');
var index = require('../../');
var DB = index.services.DB;
var blockData = require('../data/livenet-345003.json');
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var BufferUtil = bitcore.util.buffer;
var transactionData = require('../data/bitcoin-transactions.json');
var chainHashes = require('../data/hashes.json');
var chainData = require('../data/testnet-blocks.json');
var errors = index.errors;
var memdown = require('memdown');
var levelup = require('levelup');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;

describe('DB Service', function() {

  function hexlebuf(hexString){
    return BufferUtil.reverse(new Buffer(hexString, 'hex'));
  }

  function lebufhex(buf) {
    return BufferUtil.reverse(buf).toString('hex');
  }

  var baseConfig = {
    node: {
      network: Networks.testnet,
      datadir: 'testdir'
    },
    store: memdown
  };

  describe('#_setDataPath', function() {
    it('should set the database path', function() {
      var config = {
        node: {
          network: Networks.livenet,
          datadir: process.env.HOME + '/.bitcoin'
        },
        store: memdown
      };
      var db = new DB(config);
      db.dataPath.should.equal(process.env.HOME + '/.bitcoin/bitcore-node.db');
    });
    it('should load the db for testnet', function() {
      var config = {
        node: {
          network: Networks.testnet,
          datadir: process.env.HOME + '/.bitcoin'
        },
        store: memdown
      };
      var db = new DB(config);
      db.dataPath.should.equal(process.env.HOME + '/.bitcoin/testnet3/bitcore-node.db');
    });
    it('error with unknown network', function() {
      var config = {
        node: {
          network: 'unknown',
          datadir: process.env.HOME + '/.bitcoin'
        },
        store: memdown
      };
      (function() {
        var db = new DB(config);
      }).should.throw('Unknown network');
    });
    it('should load the db with regtest', function() {
      // Switch to use regtest
      // Networks.remove(Networks.testnet);
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
      var config = {
        node: {
          network: regtest,
          datadir: process.env.HOME + '/.bitcoin'
        },
        store: memdown
      };
      var db = new DB(config);
      db.dataPath.should.equal(process.env.HOME + '/.bitcoin/regtest/bitcore-node.db');
      Networks.remove(regtest);
    });
  });

  describe('#start', function() {
    var TestDB;
    var genesisBuffer;

    before(function() {
      TestDB = proxyquire('../../lib/services/db', {
        fs: {
          existsSync: sinon.stub().returns(true)
        },
        levelup: sinon.stub()
      });
      genesisBuffer = new Buffer('0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000', 'hex');
    });

    it('should emit ready', function(done) {
      var db = new TestDB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        on: sinon.spy(),
        genesisBuffer: genesisBuffer
      };
      db.getMetadata = sinon.stub().callsArg(0);
      db.connectBlock = sinon.stub().callsArg(1);
      db.saveMetadata = sinon.stub();
      db.sync = sinon.stub();
      var readyFired = false;
      db.on('ready', function() {
        readyFired = true;
      });
      db.start(function() {
        readyFired.should.equal(true);
        done();
      });
    });

    it('genesis block if no metadata is found in the db', function(done) {
      var node = {
        network: Networks.testnet,
        datadir: 'testdir',
        services: {
          bitcoind: {
            genesisBuffer: genesisBuffer,
            on: sinon.stub()
          }
        }
      };
      var db = new TestDB({node: node});
      db.getMetadata = sinon.stub().callsArgWith(0, null, null);
      db.connectBlock = sinon.stub().callsArg(1);
      db.saveMetadata = sinon.stub();
      db.sync = sinon.stub();
      db.start(function() {
        should.exist(db.tip);
        db.tip.hash.should.equal('00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206');
        done();
      });
    });

    it('metadata from the database if it exists', function(done) {
      var tipHash = '00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206';
      var node = {
        network: Networks.testnet,
        datadir: 'testdir',
        services: {
          bitcoind: {
            genesisBuffer: genesisBuffer,
            getBlockIndex: sinon.stub().returns({tip:tipHash}),
            on: sinon.stub()
          }
        }
      };
      var tip = Block.fromBuffer(genesisBuffer);
      var db = new TestDB({node: node});
      db.getMetadata = sinon.stub().callsArgWith(0, null, {
        tip: tipHash,
        tipHeight: 0
      });
      db.getBlock = sinon.stub().callsArgWith(1, null, tip);
      db.saveMetadata = sinon.stub();
      db.sync = sinon.stub();
      db.start(function() {
        should.exist(db.tip);
        db.tip.hash.should.equal(tipHash);
        done();
      });
    });

    it('emit error from getMetadata', function(done) {
      var node = {
        network: Networks.testnet,
        datadir: 'testdir',
        services: {
          bitcoind: {
            genesisBuffer: genesisBuffer,
            on: sinon.stub()
          }
        }
      };
      var db = new TestDB({node: node});
      db.getMetadata = sinon.stub().callsArgWith(0, new Error('test'));
      db.start(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });

    it('emit error from getBlock', function(done) {
      var node = {
        network: Networks.testnet,
        datadir: 'testdir',
        services: {
          bitcoind: {
            genesisBuffer: genesisBuffer,
            on: sinon.stub()
          }
        }
      };
      var db = new TestDB({node: node});
      var tipHash = '00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206';
      db.getMetadata = sinon.stub().callsArgWith(0, null, {
        tip: tipHash,
        tipHeigt: 0
      });
      db.getBlock = sinon.stub().callsArgWith(1, new Error('test'));
      db.start(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });

    it('will call sync when there is a new tip', function(done) {
      var db = new TestDB(baseConfig);
      db.node.services = {};
      db.node.services.bitcoind = new EventEmitter();
      db.node.services.bitcoind.genesisBuffer = genesisBuffer;
      db.getMetadata = sinon.stub().callsArg(0);
      db.connectBlock = sinon.stub().callsArg(1);
      db.saveMetadata = sinon.stub();
      db.sync = sinon.stub();
      db.start(function() {
        db.sync = function() {
          done();
        };
        db.node.services.bitcoind.emit('tip', 10);
      });
    });

    it('will not call sync when there is a new tip and shutting down', function(done) {
      var db = new TestDB(baseConfig);
      db.node.services = {};
      db.node.services.bitcoind = new EventEmitter();
      db.node.services.bitcoind.syncPercentage = sinon.spy();
      db.node.services.bitcoind.genesisBuffer = genesisBuffer;
      db.getMetadata = sinon.stub().callsArg(0);
      db.connectBlock = sinon.stub().callsArg(1);
      db.saveMetadata = sinon.stub();
      db.node.stopping = true;
      db.sync = sinon.stub();
      db.start(function() {
        db.sync.callCount.should.equal(1);
        db.node.services.bitcoind.once('tip', function() {
          db.sync.callCount.should.equal(1);
          done();
        });
        db.node.services.bitcoind.emit('tip', 10);
      });
    });

  });

  describe('#stop', function() {
    it('should wait until db has stopped syncing before closing leveldb', function(done) {
      var db = new DB(baseConfig);
      db.store = {
        close: sinon.stub().callsArg(0)
      };
      db.bitcoindSyncing = true;

      db.stop(function(err) {
        should.not.exist(err);
        done();
      });

      setTimeout(function() {
        db.bitcoindSyncing = false;
      }, 15);
    });
  });

  describe('#getTransaction', function() {
    it('will return a NotFound error', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getTransaction: sinon.stub().callsArgWith(2, null, null)
      };
      var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
      db.getTransaction(txid, true, function(err) {
        err.should.be.instanceof(errors.Transaction.NotFound);
        done();
      });
    });
    it('will return an error from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getTransaction: sinon.stub().callsArgWith(2, new Error('test error'))
      };
      var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
      db.getTransaction(txid, true, function(err) {
        err.message.should.equal('test error');
        done();
      });
    });
    it('will return an error from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getTransaction: sinon.stub().callsArgWith(2, null, new Buffer(transactionData[0].hex, 'hex'))
      };
      var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
      db.getTransaction(txid, true, function(err, tx) {
        if (err) {
          throw err;
        }
        should.exist(tx);
        done();
      });
    });
  });

  describe('#getBlock', function() {
    var db = new DB(baseConfig);
    var blockBuffer = new Buffer(blockData, 'hex');
    var expectedBlock = Block.fromBuffer(blockBuffer);
    db.node = {};
    db.node.services = {};
    db.node.services.bitcoind = {
      getBlock: sinon.stub().callsArgWith(1, null, blockBuffer)
    };

    it('should get the block from bitcoin daemon', function(done) {
      db.getBlock('00000000000000000593b60d8b4f40fd1ec080bdb0817d475dae47b5f5b1f735', function(err, block) {
        should.not.exist(err);
        block.hash.should.equal(expectedBlock.hash);
        done();
      });
    });
    it('should give an error when bitcoind.js gives an error', function(done) {
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {};
      db.node.services.bitcoind.getBlock = sinon.stub().callsArgWith(1, new Error('error'));
      db.getBlock('00000000000000000593b60d8b4f40fd1ec080bdb0817d475dae47b5f5b1f735', function(err, block) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
  });

  describe('#getBlockHashesByTimestamp', function() {
    it('should get the correct block hashes', function(done) {
      var db = new DB(baseConfig);
      var readStream = new EventEmitter();
      db.store = {
        createReadStream: sinon.stub().returns(readStream)
      };

      var block1 = {
        hash: '00000000050a6d07f583beba2d803296eb1e9d4980c4a20f206c584e89a4f02b',
        timestamp: 1441911909
      };

      var block2 = {
        hash: '000000000383752a55a0b2891ce018fd0fdc0b6352502772b034ec282b4a1bf6',
        timestamp: 1441913112
      };

      db.getBlockHashesByTimestamp(1441914000, 1441911000, function(err, hashes) {
        should.not.exist(err);
        hashes.should.deep.equal([block2.hash, block1.hash]);
        done();
      });

      readStream.emit('data', {
        key: db._encodeBlockIndexKey(block2.timestamp),
        value: db._encodeBlockIndexValue(block2.hash)
      });

      readStream.emit('data', {
        key: db._encodeBlockIndexKey(block1.timestamp),
        value: db._encodeBlockIndexValue(block1.hash)
      });

      readStream.emit('close');
    });

    it('should give an error if the stream has an error', function(done) {
      var db = new DB(baseConfig);
      var readStream = new EventEmitter();
      db.store = {
        createReadStream: sinon.stub().returns(readStream)
      };

      db.getBlockHashesByTimestamp(1441911000, 1441914000, function(err, hashes) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });

      readStream.emit('error', new Error('error'));

      readStream.emit('close');
    });

    it('should give an error if the timestamp is out of range', function(done) {
      var db = new DB(baseConfig);
      var readStream = new EventEmitter();
      db.store = {
        createReadStream: sinon.stub().returns(readStream)
      };

      db.getBlockHashesByTimestamp(-1, -5, function(err, hashes) {
        should.exist(err);
        err.message.should.equal('Invalid Argument: timestamp out of bounds');
        done();
      });
    });
  });

  describe('#getPrevHash', function() {
    it('should return prevHash from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getBlockIndex: sinon.stub().returns({
          prevHash: 'prevhash'
        })
      };

      db.getPrevHash('hash', function(err, prevHash) {
        should.not.exist(err);
        prevHash.should.equal('prevhash');
        done();
      });
    });

    it('should give an error if bitcoind could not find it', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getBlockIndex: sinon.stub().returns(null)
      };

      db.getPrevHash('hash', function(err, prevHash) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#getTransactionWithBlockInfo', function() {
    it('should give a transaction with height and timestamp', function(done) {
      var txBuffer = new Buffer('01000000016f95980911e01c2c664b3e78299527a47933aac61a515930a8fe0213d1ac9abe01000000da0047304402200e71cda1f71e087c018759ba3427eb968a9ea0b1decd24147f91544629b17b4f0220555ee111ed0fc0f751ffebf097bdf40da0154466eb044e72b6b3dcd5f06807fa01483045022100c86d6c8b417bff6cc3bbf4854c16bba0aaca957e8f73e19f37216e2b06bb7bf802205a37be2f57a83a1b5a8cc511dc61466c11e9ba053c363302e7b99674be6a49fc0147522102632178d046673c9729d828cfee388e121f497707f810c131e0d3fc0fe0bd66d62103a0951ec7d3a9da9de171617026442fcd30f34d66100fab539853b43f508787d452aeffffffff0240420f000000000017a9148a31d53a448c18996e81ce67811e5fb7da21e4468738c9d6f90000000017a9148ce5408cfeaddb7ccb2545ded41ef478109454848700000000', 'hex');
      var info = {
        blockHash: '00000000000ec715852ea2ecae4dc8563f62d603c820f81ac284cd5be0a944d6',
        height: 530482,
        timestamp: 1439559434000,
        buffer: txBuffer
      };

      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, null, info)
      };

      db.getTransactionWithBlockInfo('2d950d00494caf6bfc5fff2a3f839f0eb50f663ae85ce092bc5f9d45296ae91f', true, function(err, tx) {
        should.not.exist(err);
        tx.__blockHash.should.equal(info.blockHash);
        tx.__height.should.equal(info.height);
        tx.__timestamp.should.equal(info.timestamp);
        done();
      });
    });
    it('should give an error if one occurred', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, new Error('error'))
      };

      db.getTransactionWithBlockInfo('tx', true, function(err, tx) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#sendTransaction', function() {
    it('should give the txid on success', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        sendTransaction: sinon.stub().returns('txid')
      };

      var tx = new Transaction();
      db.sendTransaction(tx, function(err, txid) {
        should.not.exist(err);
        txid.should.equal('txid');
        done();
      });
    });
    it('should give an error if bitcoind threw an error', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        sendTransaction: sinon.stub().throws(new Error('error'))
      };

      var tx = new Transaction();
      db.sendTransaction(tx, function(err, txid) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#estimateFee', function() {
    it('should pass along the fee from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      db.node.services.bitcoind = {
        estimateFee: sinon.stub().returns(1000)
      };

      db.estimateFee(5, function(err, fee) {
        should.not.exist(err);
        fee.should.equal(1000);
        db.node.services.bitcoind.estimateFee.args[0][0].should.equal(5);
        done();
      });
    });
  });

  describe('#saveMetadata', function() {
    it('will emit an error with default callback', function(done) {
      var db = new DB(baseConfig);
      db.cache = {
        hashes: {},
        chainHashes: {}
      };
      db.tip = {
        hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        __height: 0
      };
      db.store = {
        put: sinon.stub().callsArgWith(3, new Error('test'))
      };
      db.on('error', function(err) {
        err.message.should.equal('test');
        done();
      });
      db.saveMetadata();
    });
    it('will give an error with callback', function(done) {
      var db = new DB(baseConfig);
      db.cache = {
        hashes: {},
        chainHashes: {}
      };
      db.tip = {
        hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        __height: 0
      };
      db.store = {
        put: sinon.stub().callsArgWith(3, new Error('test'))
      };
      db.saveMetadata(function(err) {
        err.message.should.equal('test');
        done();
      });
    });
    it('will call store with the correct arguments', function(done) {
      var db = new DB(baseConfig);
      db.cache = {
        hashes: {},
        chainHashes: {}
      };
      db.tip = {
        hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        __height: 0
      };
      db.store = {
        put: function(key, value, options, callback) {
          key.should.equal('metadata');
          JSON.parse(value).should.deep.equal({
            tip: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
          });
          options.should.deep.equal({});
          callback.should.be.a('function');
          done();
        }
      };
      db.saveMetadata();
    });
  });

  describe('#getMetadata', function() {
    it('will get metadata', function() {
      var db = new DB(baseConfig);
      var json = JSON.stringify({
        tip: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
        tipHeight: 101,
        cache: {
          hashes: {},
          chainHashes: {}
        }
      });
      db.store = {};
      db.store.get = sinon.stub().callsArgWith(2, null, json);
      db.getMetadata(function(err, data) {
        data.tip.should.equal('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
        data.tipHeight.should.equal(101);
        data.cache.should.deep.equal({
          hashes: {},
          chainHashes: {}
        });
      });
    });
    it('will handle a notfound error from leveldb', function() {
      var db = new DB(baseConfig);
      db.store = {};
      var error = new levelup.errors.NotFoundError();
      db.store.get = sinon.stub().callsArgWith(2, error);
      db.getMetadata(function(err, data) {
        should.not.exist(err);
        data.should.deep.equal({});
      });
    });
    it('will handle error from leveldb', function() {
      var db = new DB(baseConfig);
      db.store = {};
      db.store.get = sinon.stub().callsArgWith(2, new Error('test'));
      db.getMetadata(function(err) {
        err.message.should.equal('test');
      });
    });
    it('give an error when parsing invalid json', function() {
      var db = new DB(baseConfig);
      db.store = {};
      db.store.get = sinon.stub().callsArgWith(2, null, '{notvalid@json}');
      db.getMetadata(function(err) {
        err.message.should.equal('Could not parse metadata');
      });
    });
  });

  describe('#connectBlock', function() {
    it('should remove block from mempool and call blockHandler with true', function(done) {
      var db = new DB(baseConfig);
      db.mempool = {
        removeBlock: sinon.stub()
      };
      db.runAllBlockHandlers = sinon.stub().callsArg(2);
      db.connectBlock({hash: 'hash'}, function(err) {
        should.not.exist(err);
        db.runAllBlockHandlers.args[0][1].should.equal(true);
        done();
      });
    });
  });

  describe('#disconnectBlock', function() {
    it('should call blockHandler with false', function(done) {
      var db = new DB(baseConfig);
      db.runAllBlockHandlers = sinon.stub().callsArg(2);
      db.disconnectBlock({hash: 'hash'}, function(err) {
        should.not.exist(err);
        db.runAllBlockHandlers.args[0][1].should.equal(false);
        done();
      });
    });
  });

  describe('#runAllBlockHandlers', function() {
    var db = new DB(baseConfig);
    var Service1 = function() {};
    Service1.prototype.blockHandler = sinon.stub().callsArgWith(2, null, ['op1', 'op2', 'op3']);
    var Service2 = function() {};
    Service2.prototype.blockHandler = sinon.stub().callsArgWith(2, null, ['op4', 'op5']);
    var Service3 = function() {};
    var Service4 = function() {};
    Service4.prototype.blockHandler = sinon.stub().callsArgWith(2, null, 'bad-value');
    db.node = {};
    db.node.services = {
      service1: new Service1(),
      service2: new Service2()
    };
    db.store = {
      batch: sinon.stub().callsArg(1)
    };

    var block = {
      hash: '00000000000000000d0aaf93e464ddeb503655a0750f8b9c6eed0bdf0ccfc863',
      header: {
        timestamp: 1441906365
      }
    };

    it('should call blockHandler in all services and perform operations', function(done) {
      db.runAllBlockHandlers(block, true, function(err) {
        should.not.exist(err);
        var blockOp = {
          type: 'put',
          key: db._encodeBlockIndexKey(1441906365),
          value: db._encodeBlockIndexValue('00000000000000000d0aaf93e464ddeb503655a0750f8b9c6eed0bdf0ccfc863')
        };
        db.store.batch.args[0][0].should.deep.equal([blockOp, 'op1', 'op2', 'op3', 'op4', 'op5']);
        done();
      });
    });

    it('should give an error if one of the services gives an error', function(done) {
      var Service3 = function() {};
      Service3.prototype.blockHandler = sinon.stub().callsArgWith(2, new Error('error'));
      db.node.services.service3 = new Service3();

      db.runAllBlockHandlers(block, true, function(err) {
        should.exist(err);
        done();
      });
    });

    it('should not give an error if a service does not have blockHandler', function(done) {
      db.node = {};
      db.node.services = {
        service3: new Service3()
      };

      db.runAllBlockHandlers(block, true, function(err) {
        should.not.exist(err);
        done();
      });
    });

    it('should throw an error if blockHandler gives unexpected result', function() {
      db.node = {};
      db.node.services = {
        service4: new Service4()
      };

      (function() {
        db.runAllBlockHandlers(block, true, function(err) {
          should.not.exist(err);
        });
      }).should.throw('bitcore.ErrorInvalidArgument');
    });
  });

  describe('#getAPIMethods', function() {
    it('should return the correct db methods', function() {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.services = {};
      var methods = db.getAPIMethods();
      methods.length.should.equal(6);
    });
  });

  describe('#findCommonAncestor', function() {
    it('will find an ancestor 6 deep', function(done) {
      var db = new DB(baseConfig);
      db.tip = {
        hash: chainHashes[chainHashes.length - 1]
      };

      var expectedAncestor = chainHashes[chainHashes.length - 6];

      var mainBlocks = {};
      for(var i = chainHashes.length - 1; i > chainHashes.length - 10; i--) {
        var hash = chainHashes[i];
        var prevHash = hexlebuf(chainHashes[i - 1]);
        mainBlocks[hash] = {
          header: {
            prevHash: prevHash
          }
        };
      }

      var forkedBlocks = {
        'd7fa6f3d5b2fe35d711e6aca5530d311b8c6e45f588a65c642b8baf4b4441d82': {
          header: {
            prevHash: hexlebuf('76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a')
          },
          hash: 'd7fa6f3d5b2fe35d711e6aca5530d311b8c6e45f588a65c642b8baf4b4441d82'
        },
        '76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a': {
          header: {
            prevHash: hexlebuf('f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c')
          },
          hash: '76d920dbd83beca9fa8b2f346d5c5a81fe4a350f4b355873008229b1e6f8701a'
        },
        'f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c': {
          header: {
            prevHash: hexlebuf('2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31')
          },
          hash: 'f0a0d76a628525243c8af7606ee364741ccd5881f0191bbe646c8a4b2853e60c'
        },
        '2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31': {
          header: {
            prevHash: hexlebuf('adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453')
          },
          hash: '2f72b809d5ccb750c501abfdfa8c4c4fad46b0b66c088f0568d4870d6f509c31'
        },
        'adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453': {
          header: {
            prevHash: hexlebuf('3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618')
          },
          hash: 'adf66e6ae10bc28fc22bc963bf43e6b53ef4429269bdb65038927acfe66c5453'
        },
        '3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618': {
          header: {
            prevHash: hexlebuf(expectedAncestor)
          },
          hash: '3ea12707e92eed024acf97c6680918acc72560ec7112cf70ac213fb8bb4fa618'
        }
      };
      db.node.services = {};
      db.node.services.bitcoind = {
        getBlockIndex: function(hash) {
          var forkedBlock = forkedBlocks[hash];
          var mainBlock = mainBlocks[hash];
          var prevHash;
          if (forkedBlock && forkedBlock.header.prevHash) {
            prevHash = BufferUtil.reverse(forkedBlock.header.prevHash).toString('hex');
          } else if (mainBlock && mainBlock.header.prevHash){
            prevHash = BufferUtil.reverse(mainBlock.header.prevHash).toString('hex');
          } else {
            return null;
          }
          return {
            prevHash: prevHash
          };
        }
      };
      var block = forkedBlocks['d7fa6f3d5b2fe35d711e6aca5530d311b8c6e45f588a65c642b8baf4b4441d82'];
      db.findCommonAncestor(block, function(err, ancestorHash) {
        if (err) {
          throw err;
        }
        ancestorHash.should.equal(expectedAncestor);
        done();
      });
    });
  });

  describe('#syncRewind', function() {
    it('will undo blocks 6 deep', function() {
      var db = new DB(baseConfig);
      var ancestorHash = chainHashes[chainHashes.length - 6];
      db.tip = {
        __height: 10,
        hash: chainHashes[chainHashes.length],
        header: {
          prevHash: hexlebuf(chainHashes[chainHashes.length - 1])
        }
      };
      db.saveMetadata = sinon.stub();
      db.emit = sinon.stub();
      db.getBlock = function(hash, callback) {
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
      db.node.services = {};
      db.disconnectBlock = function(block, callback) {
        setImmediate(callback);
      };
      db.findCommonAncestor = function(block, callback) {
        setImmediate(function() {
          callback(null, ancestorHash);
        });
      };
      var forkedBlock = {};
      db.syncRewind(forkedBlock, function(err) {
        if (err) {
          throw err;
        }
        db.tip.__height.should.equal(4);
        db.tip.hash.should.equal(ancestorHash);
      });
    });
  });

  describe('#sync', function() {
    var node = new EventEmitter();
    var syncConfig = {
      node: node,
      store: memdown
      };
    syncConfig.node.network = Networks.testnet;
    syncConfig.node.datadir = 'testdir';
    it('will get and add block up to the tip height', function(done) {
      var db = new DB(syncConfig);
      var blockBuffer = new Buffer(blockData, 'hex');
      var block = Block.fromBuffer(blockBuffer);
      db.node.services = {};
      db.runAllMempoolIndexes = sinon.stub().callsArg(0);
      db.node.services.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer),
        isSynced: sinon.stub().returns(true),
        height: 1
      };
      db.tip = {
        __height: 0,
        hash: lebufhex(block.header.prevHash)
      };
      db.saveMetadata = sinon.stub();
      db.emit = sinon.stub();
      db.cache = {
        hashes: {}
      };
      db.connectBlock = function(block, callback) {
        db.tip.__height += 1;
        callback();
      };
      db.node.once('synced', function() {
        db.runAllMempoolIndexes.callCount.should.equal(1);
        done();
      });
      db.sync();
    });
    it('will exit and emit error with error from bitcoind.getBlock', function(done) {
      var db = new DB(syncConfig);
      db.node.services = {};
      db.node.services.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, new Error('test error')),
        height: 1
      };
      db.tip = {
        __height: 0
      };
      db.node.on('error', function(err) {
        err.message.should.equal('test error');
        done();
      });
      db.sync();
    });
    it('will stop syncing when the node is stopping', function(done) {
      var db = new DB(syncConfig);
      var blockBuffer = new Buffer(blockData, 'hex');
      var block = Block.fromBuffer(blockBuffer);
      db.node.services = {};
      db.node.services.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer),
        isSynced: sinon.stub().returns(true),
        height: 1
      };
      db.tip = {
        __height: 0,
        hash: block.prevHash
      };
      db.saveMetadata = sinon.stub();
      db.emit = sinon.stub();
      db.cache = {
        hashes: {}
      };
      db.connectBlock = function(block, callback) {
        db.tip.__height += 1;
        callback();
      };
      db.node.stopping = true;
      var synced = false;
      db.node.once('synced', function() {
        synced = true;
      });
      db.sync();
      setTimeout(function() {
        synced.should.equal(false);
        done();
      }, 10);
    });
  });

});
