'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var index = require('../../');
var DB = index.modules.DBModule;
var blockData = require('../data/livenet-345003.json');
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var transactionData = require('../data/bitcoin-transactions.json');
var errors = index.errors;
var memdown = require('memdown');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;

describe('DB Module', function() {

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

  describe('#start', function() {
    it('should emit ready', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
        on: sinon.spy()
      };
      db.addModule = sinon.spy();
      var readyFired = false;
      db.on('ready', function() {
        readyFired = true;
      });
      db.start(function() {
        readyFired.should.equal(true);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('should immediately call the callback', function(done) {
      var db = new DB(baseConfig);

      db.stop(function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('#getTransaction', function() {
    it('will return a NotFound error', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
    db.node.modules = {};
    db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {};
      db.node.modules.bitcoind.getBlock = sinon.stub().callsArgWith(1, new Error('error'));
      db.getBlock('00000000000000000593b60d8b4f40fd1ec080bdb0817d475dae47b5f5b1f735', function(err, block) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
  });

  describe('#getPrevHash', function() {
    it('should return prevHash from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
        height: 530482,
        timestamp: 1439559434000,
        buffer: txBuffer
      };

      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
        getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, null, info)
      };

      db.getTransactionWithBlockInfo('2d950d00494caf6bfc5fff2a3f839f0eb50f663ae85ce092bc5f9d45296ae91f', true, function(err, tx) {
        should.not.exist(err);
        tx.__height.should.equal(info.height);
        tx.__timestamp.should.equal(info.timestamp);
        done();
      });
    });
    it('should give an error if one occurred', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {
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
      db.node.modules = {};
      db.node.modules.bitcoind = {
        sendTransaction: sinon.stub().throws(new Error('error'))
      };

      var tx = new Transaction();
      db.sendTransaction(tx, function(err, txid) {
        should.exist(err);
        done();
      });
    });
  });

  describe("#estimateFee", function() {
    it('should pass along the fee from bitcoind', function(done) {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      db.node.modules.bitcoind = {
        estimateFee: sinon.stub().returns(1000)
      };

      db.estimateFee(5, function(err, fee) {
        should.not.exist(err);
        fee.should.equal(1000);
        db.node.modules.bitcoind.estimateFee.args[0][0].should.equal(5);
        done();
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
    var Module1 = function() {};
    Module1.prototype.blockHandler = sinon.stub().callsArgWith(2, null, ['op1', 'op2', 'op3']);
    var Module2 = function() {};
    Module2.prototype.blockHandler = sinon.stub().callsArgWith(2, null, ['op4', 'op5']);
    db.node = {};
    db.node.modules = {
      module1: new Module1(),
      module2: new Module2()
    };
    db.store = {
      batch: sinon.stub().callsArg(1)
    };

    it('should call blockHandler in all modules and perform operations', function(done) {
      db.runAllBlockHandlers('block', true, function(err) {
        should.not.exist(err);
        db.store.batch.args[0][0].should.deep.equal(['op1', 'op2', 'op3', 'op4', 'op5']);
        done();
      });
    });

    it('should give an error if one of the modules gives an error', function(done) {
      var Module3 = function() {};
      Module3.prototype.blockHandler = sinon.stub().callsArgWith(2, new Error('error'));
      db.node.modules.module3 = new Module3();

      db.runAllBlockHandlers('block', true, function(err) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#getAPIMethods', function() {
    it('should return the correct db methods', function() {
      var db = new DB(baseConfig);
      db.node = {};
      db.node.modules = {};
      var methods = db.getAPIMethods();
      methods.length.should.equal(5);
    });
  });
});
