'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcoindjs = require('../');
var DB = bitcoindjs.DB;
var blockData = require('./data/livenet-345003.json');
var transactionData = require('./data/bitcoin-transactions.json');
var errors = bitcoindjs.errors;
var memdown = require('memdown');
var inherits = require('util').inherits;
var BaseModule = require('../lib/module');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;

describe('Bitcoin DB', function() {
  var coinbaseAmount = 50 * 1e8;

  describe('#start', function() {
    it('should emit ready', function(done) {
      var db = new DB({store: memdown});
      db._modules = ['mod1', 'mod2'];
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
    db.bitcoind = {
      getBlock: sinon.stub().callsArgWith(1, null, new Buffer(blockData, 'hex'))
    };
    db.Block = {
      fromBuffer: sinon.stub().returns('block')
    };

    it('should get the block from bitcoind.js', function(done) {
      db.getBlock('00000000000000000593b60d8b4f40fd1ec080bdb0817d475dae47b5f5b1f735', function(err, block) {
        should.not.exist(err);
        block.should.equal('block');
        done();
      });
    });
    it('should give an error when bitcoind.js gives an error', function(done) {
      db.bitcoind.getBlock = sinon.stub().callsArgWith(1, new Error('error'));
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
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
      db.bitcoind = {
        estimateFee: sinon.stub().returns(1000)
      };

      db.estimateFee(5, function(err, fee) {
        should.not.exist(err);
        fee.should.equal(1000);
        db.bitcoind.estimateFee.args[0][0].should.equal(5);
        done();
      });
    });
  });
  describe('#buildGenesisData', function() {
    it('build genisis data', function() {
      var db = new DB({path: 'path', store: memdown});
      db.buildCoinbaseTransaction = sinon.stub().returns({
        toBuffer: sinon.stub().returns(new Buffer('abcdef', 'hex'))
      });
      db.getMerkleRoot = sinon.stub().returns('merkleRoot');
      var data = db.buildGenesisData();
      data.buffer.should.deep.equal(new Buffer('01abcdef', 'hex'));
      data.merkleRoot.should.equal('merkleRoot');
    });
  });

  describe('#buildCoinbaseTransaction', function() {
    it('should correctly build a coinbase transaction with no fees', function() {
      var db = new DB({path: 'path', store: memdown});
      db.coinbaseAddress = 'mzso6uXxfDCq4L6xAffUD9BPWo6bdFBZ2L';
      db.coinbaseAmount = coinbaseAmount;
      var coinbaseTx = db.buildCoinbaseTransaction();
      coinbaseTx.inputs.length.should.equal(1);
      var input = coinbaseTx.inputs[0];
      var expectedTxId = '0000000000000000000000000000000000000000000000000000000000000000';
      input.prevTxId.toString('hex').should.equal(expectedTxId);
      should.exist(input.outputIndex);
      should.exist(input.sequenceNumber);
      should.exist(input._script); // coinbase input script returns null
      coinbaseTx.outputs.length.should.equal(1);
      var output = coinbaseTx.outputs[0];
      output.satoshis.should.equal(coinbaseAmount);
    });

    it('should correctly build a coinbase transaction with fees', function() {
      var db = new DB({path: 'path', store: memdown});
      db.coinbaseAddress = 'mzso6uXxfDCq4L6xAffUD9BPWo6bdFBZ2L';
      db.coinbaseAmount = coinbaseAmount;
      var transactions = [
        {
          _getInputAmount: sinon.stub().returns(5000),
          _getOutputAmount: sinon.stub().returns(4000),
          isCoinbase: sinon.stub().returns(false)
        },
        {
          _getInputAmount: sinon.stub().returns(8000),
          _getOutputAmount: sinon.stub().returns(7000),
          isCoinbase: sinon.stub().returns(false)
        }
      ];
      var coinbaseTx = db.buildCoinbaseTransaction(transactions);
      coinbaseTx.inputs.length.should.equal(1);
      var input = coinbaseTx.inputs[0];
      var expectedTxId = '0000000000000000000000000000000000000000000000000000000000000000';
      input.prevTxId.toString('hex').should.equal(expectedTxId);
      should.exist(input.outputIndex);
      should.exist(input.sequenceNumber);
      should.exist(input._script); // coinbase input returns null
      coinbaseTx.outputs.length.should.equal(1);
      var output = coinbaseTx.outputs[0];
      output.satoshis.should.equal(coinbaseAmount + 2000);
    });

    it('should throw an error if coinbaseAddress not included', function() {
      var db = new DB({path: 'path', store: memdown});
      (function() {
        db.buildCoinbaseTransaction();
      }).should.throw('coinbaseAddress required to build coinbase');
    });

    it('will build a coinbase database with different data', function() {
      var db = new DB({path: 'path', store: memdown});
      db.coinbaseAddress = 'mzso6uXxfDCq4L6xAffUD9BPWo6bdFBZ2L';
      var tx1 = db.buildCoinbaseTransaction().uncheckedSerialize();
      var tx2 = db.buildCoinbaseTransaction().uncheckedSerialize();
      tx1.should.not.equal(tx2);
    });

    it('can pass in custom data', function() {
      var db = new DB({path: 'path', store: memdown});
      db.coinbaseAddress = 'mzso6uXxfDCq4L6xAffUD9BPWo6bdFBZ2L';
      var tx1 = db.buildCoinbaseTransaction(null, new Buffer('abcdef', 'hex'));
      var data = tx1.inputs[0]._script.getData();
      data.should.deep.equal(new Buffer('abcdef', 'hex'));
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
      grandTotal.should.equal(50)
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
        db.mempool.removeBlock.args[0][0].should.equal('hash');
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
    db.modules = [
      new Module1(),
      new Module2()
    ];
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
      db.modules.push(new Module3());

      db.blockHandler('block', true, function(err) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#getAPIMethods', function() {
    it('should return the correct db methods', function() {
      var db = new DB({store: memdown});
      db.modules = [];
      var methods = db.getAPIMethods();
      methods.length.should.equal(4);
    });

    it('should also return modules API methods', function() {
      var module1 = {
        getAPIMethods: function() {
          return [
            ['module1-one', module1, module1, 2],
            ['module1-two', module1, module1, 2]
          ];
        }
      };
      var module2 = {
        getAPIMethods: function() {
          return [
            ['moudle2-one', module2, module2, 1]
          ];
        }
      };

      var db = new DB({store: memdown});
      db.modules = [module1, module2];

      var methods = db.getAPIMethods();
      methods.length.should.equal(7);
    });
  });

  describe('#addModule', function() {
    it('instantiate module and add to db.modules', function() {
      var Module1 = function(options) {
        BaseModule.call(this, options);
      };
      inherits(Module1, BaseModule);

      var db = new DB({store: memdown});
      db.modules = [];
      db.addModule(Module1);

      db.modules.length.should.equal(1);
      should.exist(db.modules[0].db);
    });

    it('should throw an error if module is not an instance of BaseModule', function() {
      var Module2 = function(options) {};
      var db = new DB({store: memdown});
      db.modules = [];

      (function() {
        db.addModule(Module2);
      }).should.throw('bitcore.ErrorInvalidArgumentType');
    });
  });
});
