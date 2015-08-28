'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var index = require('../');
var DB = index.DB;
var blockData = require('./data/livenet-345003.json');
var bitcore = require('bitcore');
var Block = bitcore.Block;
var transactionData = require('./data/bitcoin-transactions.json');
var errors = index.errors;
var memdown = require('memdown');
var inherits = require('util').inherits;
var BaseModule = require('../lib/module');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;

describe('Bitcoin DB', function() {

  describe('#start', function() {
    it('should emit ready', function(done) {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});

      db.stop(function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('#getTransaction', function() {
    it('will return a NotFound error', function(done) {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
        getTransaction: sinon.stub().callsArgWith(2, null, null)
      };
      var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
      db.getTransaction(txid, true, function(err) {
        err.should.be.instanceof(errors.Transaction.NotFound);
        done();
      });
    });
    it('will return an error from bitcoind', function(done) {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
        getTransaction: sinon.stub().callsArgWith(2, new Error('test error'))
      };
      var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
      db.getTransaction(txid, true, function(err) {
        err.message.should.equal('test error');
        done();
      });
    });
    it('will return an error from bitcoind', function(done) {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
    var db = new DB({store: memdown});
    var blockBuffer = new Buffer(blockData, 'hex');
    var expectedBlock = Block.fromBuffer(blockBuffer);
    db.node = {};
    db.node.bitcoind = {
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
      db.node.bitcoind = {};
      db.node.bitcoind.getBlock = sinon.stub().callsArgWith(1, new Error('error'));
      db.getBlock('00000000000000000593b60d8b4f40fd1ec080bdb0817d475dae47b5f5b1f735', function(err, block) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
  });

  describe('#putBlock', function() {
    it('should call callback', function(done) {
      var db = new DB({store: memdown});
      db.putBlock('block', function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('#getPrevHash', function() {
    it('should return prevHash from bitcoind', function(done) {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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

      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
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
      var db = new DB({store: memdown});
      db.node = {};
      db.node.bitcoind = {
        estimateFee: sinon.stub().returns(1000)
      };

      db.estimateFee(5, function(err, fee) {
        should.not.exist(err);
        fee.should.equal(1000);
        db.node.bitcoind.estimateFee.args[0][0].should.equal(5);
        done();
      });
    });
  });

  describe('#getOutputTotal', function() {
    it('should return the correct value including the coinbase', function() {
      var totals = [10, 20, 30];
      var db = new DB({path: 'path', store: memdown});
      var transactions = totals.map(function(total) {
        return {
          _getOutputAmount: function() {
            return total;
          },
          isCoinbase: function() {
            return total === 10 ? true : false;
          }
        };
      });
      var grandTotal = db.getOutputTotal(transactions);
      grandTotal.should.equal(60);
    });
    it('should return the correct value excluding the coinbase', function() {
      var totals = [10, 20, 30];
      var db = new DB({path: 'path', store: memdown});
      var transactions = totals.map(function(total) {
        return {
          _getOutputAmount: function() {
            return total;
          },
          isCoinbase: function() {
            return total === 10 ? true : false;
          }
        };
      });
      var grandTotal = db.getOutputTotal(transactions, true);
      grandTotal.should.equal(50);
    });
  });

  describe('#getInputTotal', function() {
    it('should return the correct value', function() {
      var totals = [10, 20, 30];
      var db = new DB({path: 'path', store: memdown});
      var transactions = totals.map(function(total) {
        return {
          _getInputAmount: function() {
            return total;
          },
          isCoinbase: sinon.stub().returns(false)
        };
      });
      var grandTotal = db.getInputTotal(transactions);
      grandTotal.should.equal(60);
    });
    it('should return 0 if the tx is a coinbase', function() {
      var db = new DB({store: memdown});
      var tx = {
        isCoinbase: sinon.stub().returns(true)
      };
      var total = db.getInputTotal([tx]);
      total.should.equal(0);
    });
  });

  describe('#_onChainAddBlock', function() {
    it('should remove block from mempool and call blockHandler with true', function(done) {
      var db = new DB({store: memdown});
      db.mempool = {
        removeBlock: sinon.stub()
      };
      db.blockHandler = sinon.stub().callsArg(2);
      db._onChainAddBlock({hash: 'hash'}, function(err) {
        should.not.exist(err);
        db.blockHandler.args[0][1].should.equal(true);
        done();
      });
    });
  });

  describe('#_onChainRemoveBlock', function() {
    it('should call blockHandler with false', function(done) {
      var db = new DB({store: memdown});
      db.blockHandler = sinon.stub().callsArg(2);
      db._onChainRemoveBlock({hash: 'hash'}, function(err) {
        should.not.exist(err);
        db.blockHandler.args[0][1].should.equal(false);
        done();
      });
    });
  });

  describe('#blockHandler', function() {
    var db = new DB({store: memdown});
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
      db.blockHandler('block', true, function(err) {
        should.not.exist(err);
        db.store.batch.args[0][0].should.deep.equal(['op1', 'op2', 'op3', 'op4', 'op5']);
        done();
      });
    });

    it('should give an error if one of the modules gives an error', function(done) {
      var Module3 = function() {};
      Module3.prototype.blockHandler = sinon.stub().callsArgWith(2, new Error('error'));
      db.node.modules.module3 = new Module3();

      db.blockHandler('block', true, function(err) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#getAPIMethods', function() {
    it('should return the correct db methods', function() {
      var db = new DB({store: memdown});
      db.node = {};
      db.node.modules = {};
      var methods = db.getAPIMethods();
      methods.length.should.equal(5);
    });
  });

});
