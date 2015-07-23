'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var chainlib = require('chainlib');
var levelup = chainlib.deps.levelup;
var bitcoindjs = require('../');
var DB = bitcoindjs.DB;
var blockData = require('./data/livenet-345003.json');
var bitcore = require('bitcore');
var EventEmitter = require('events').EventEmitter;
var errors = bitcoindjs.errors;
var memdown = require('memdown');
var inherits = require('util').inherits;
var BaseModule = require('../lib/module');

describe('Bitcoin DB', function() {
  var coinbaseAmount = 50 * 1e8;

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
      methods.length.should.equal(2);
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
      methods.length.should.equal(5);
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
