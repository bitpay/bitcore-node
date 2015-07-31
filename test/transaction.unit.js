'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcoinlib = require('../');
var Transaction = bitcoinlib.Transaction;
var transactionData = require('./data/bitcoin-transactions.json');
var memdown = require('memdown');
var DB = bitcoinlib.DB;
var db = new DB({store: memdown});
var chainlib = require('chainlib');
var levelup = chainlib.deps.levelup;

describe('Bitcoin Transaction', function() {
  describe('#validate', function() {
    it('should give an error if verify() fails', function(done) {
      var tx = new Transaction();
      tx.verify = sinon.stub().returns('invalid tx');
      tx.validate(db, [], function(err) {
        should.exist(err);
        err.message.should.equal('invalid tx');
        done();
      });
    });
    it('should give an error if one if the async series functions fails', function(done) {
      var tx = new Transaction();
      tx._validateInputs = sinon.stub().callsArg(2);
      tx._validateOutputs = sinon.stub().callsArgWith(0, new Error('output validation error'));
      tx._checkSufficientInputs = sinon.stub().callsArg(0);
      tx.verify = sinon.stub().returns(true);
      tx.validate(db, [], function(err) {
        should.exist(err);
        err.message.should.equal('output validation error');
        tx._validateInputs.calledOnce.should.equal(true);
        tx._validateOutputs.calledOnce.should.equal(true);
        tx._checkSufficientInputs.called.should.equal(false);
        done();
      });
    });
    it('should call all the functions if there is no error', function(done) {
      var tx = new Transaction();
      tx._validateInputs = sinon.stub().callsArg(2);
      tx._validateOutputs = sinon.stub().callsArg(0);
      tx._checkSufficientInputs = sinon.stub().callsArg(0);
      tx.verify = sinon.stub().returns(true);
      tx.validate(db, [], function(err) {
        should.not.exist(err);
        tx._validateInputs.calledOnce.should.equal(true);
        tx._validateOutputs.calledOnce.should.equal(true);
        tx._checkSufficientInputs.calledOnce.should.equal(true);
        done();
      });
    });
  });
  describe('#_validateInputs', function() {
    it('should call all the functions and complete when no errors', function(done) {
      var tx = new Transaction();
      tx.inputs = ['input'];
      sinon.stub(tx, '_populateInput', function(db, input, poolTransactions, callback) {
        return callback(null, input, 'populateInput');
      });
      sinon.stub(tx, '_checkSpent', function(db, input, poolTransactions, callback) {
        return callback();
      });
      sinon.stub(tx, '_checkScript', function(db, input, index, callback) {
        return callback();
      });

      tx._validateInputs('db', [], function(err) {
        should.not.exist(err);
        tx._populateInput.calledOnce.should.equal(true);
        tx._populateInput.calledWith('db', 'input');
        tx._checkSpent.calledOnce.should.equal(true);
        tx._populateInput.calledWith('db', 'input');
        tx._checkScript.calledOnce.should.equal(true);
        tx._populateInput.calledWith('input');
        done();
      });
    });
    it('should halt on an error', function(done) {
      var tx = new Transaction();
      tx.inputs = ['input'];
      sinon.stub(tx, '_populateInput', function(db, input, poolTransactions, callback) {
        return callback();
      });
      sinon.stub(tx, '_checkSpent', function(db, input, poolTransactions, callback) {
        return callback(new Error('error'));
      });
      sinon.stub(tx, '_checkScript', function(input, callback) {
        return callback();
      });

      tx._validateInputs('db', [], function(err) {
        should.exist(err);
        err.message.should.equal('error');
        tx._populateInput.calledOnce.should.equal(true);
        tx._populateInput.calledWith('input');
        tx._checkSpent.calledOnce.should.equal(true);
        tx._populateInput.calledWith('input');
        tx._checkScript.called.should.equal(false);
        done();
      });
    });
  });

  describe('#populateInputs', function() {
    it('will call _populateInput with transactions', function() {
      var tx = new Transaction();
      tx.isCoinbase = sinon.stub().returns(false);
      tx._populateInput = sinon.stub().callsArg(3);
      tx.inputs = ['input'];
      var transactions = [];
      var db = {};
      tx.populateInputs(db, transactions, function(err) {
        tx._populateInput.callCount.should.equal(1);
        tx._populateInput.args[0][0].should.equal(db);
        tx._populateInput.args[0][1].should.equal('input');
        tx._populateInput.args[0][2].should.equal(transactions);
      });
    });
  });

  describe('#_populateInput', function() {
    var input = {
      prevTxId: new Buffer('d6cffbb343a6a41eeaa199478c985493843bfe6a59d674a5c188787416cbcda3', 'hex'),
      outputIndex: 0
    };
    it('should give an error if the input does not have a valid prevTxId', function(done) {
      var badInput = {
        prevTxId: 'bad'
      };
      var tx = new Transaction();
      tx._populateInput({}, badInput, [], function(err) {
        should.exist(err);
        err.message.should.equal('Input is expected to have prevTxId as a buffer');
        done();
      });
    });
    it('if an error happened it should pass it along', function(done) {
      var tx = new Transaction();
      var db = {
        getTransaction: sinon.stub().callsArgWith(2, new Error('error'))
      };
      tx._populateInput(db, input, [], function(err) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
    it('should return an error if the transaction for the input does not exist', function(done) {
      var tx = new Transaction();
      var db = {
        getTransaction: sinon.stub().callsArgWith(2, new levelup.errors.NotFoundError())
      };
      tx._populateInput(db, input, [], function(err) {
        should.exist(err);
        err.message.should.equal('Previous tx ' + input.prevTxId.toString('hex') + ' not found');
        done();
      });
    });
    it('should look through poolTransactions if database does not have transaction', function(done) {
      var tx = new Transaction();
      var db = {
        getTransaction: sinon.stub().callsArgWith(2, new levelup.errors.NotFoundError())
      };
      var transactions = [
        {
          hash: 'd6cffbb343a6a41eeaa199478c985493843bfe6a59d674a5c188787416cbcda3',
          outputs: ['output']
        }
      ];
      tx._populateInput(db, input, transactions, function(err) {
        should.not.exist(err);
        input.output.should.equal('output');
        done();
      });
    });
    it('should not return an error if an error did not occur', function(done) {
      var prevTx = new Transaction();
      prevTx.outputs = ['output'];
      var tx = new Transaction();
      var db = {
        getTransaction: sinon.stub().callsArgWith(2, null, prevTx)
      };
      tx._populateInput(db, input, [], function(err) {
        should.not.exist(err);
        input.output.should.equal('output');
        done();
      });
    });
  });

  describe('#_checkSpent', function() {
    it('should return an error if input was spent', function(done) {
      var tx = new Transaction();
      var db = {
        isSpentDB: sinon.stub().callsArgWith(1, true)
      };
      tx._checkSpent(db, [], 'input', function(err) {
        should.exist(err);
        err.message.should.equal('Input already spent');
        done();
      });
    });
    it('should not return an error if input was unspent', function(done) {
      var tx = new Transaction();
      var db = {
        isSpentDB: sinon.stub().callsArgWith(1, false)
      };
      tx._checkSpent(db, [], 'input', function(err) {
        should.not.exist(err);
        done();
      });
    });
  });


  describe('#_checkScript', function() {
    it('should not have an error with a valid script', function(done) {
      var prevTx = new Transaction();
      prevTx.fromString(transactionData[0].hex);
      var tx = new Transaction();
      tx.fromString(transactionData[1].hex);
      var input = tx.inputs[0];
      input.output = prevTx.outputs[0];
      var db = {
        bitcoind: {
          verifyScript: sinon.stub().returns(true)
        }
      };

      tx._checkScript(db, input, 0, function(err) {
        should.not.exist(err);
        done();
      });
    });
    it('should have an error when signature is missing', function(done) {
      var prevTx = new Transaction();
      prevTx.fromString(transactionData[0].hex);
      var tx = new Transaction();
      tx.fromString(transactionData[2].hex);
      var input = tx.inputs[0];
      input.output = prevTx.outputs[0];
      var db = {
        bitcoind: {
          verifyScript: sinon.stub().returns(false)
        }
      };

      tx._checkScript(db, input, 0, function(err) {
        should.exist(err);
        done();
      });
    });
  });
  describe('#_checkSufficientInputs', function() {
    var inputs = [
      {
        outputIndex: 0,
        output: {
          satoshis: 1000
        }
      },
      {
        outputIndex: 0,
        output: {
          satoshis: 2000
        }
      },
      {
        outputIndex: 1,
        output: {
          satoshis: 3000
        }
      },
    ];

    var outputs = [
      {
        satoshis: 4000
      },
      {
        satoshis: 3000
      }
    ];

    it('should give an error if inputs are less than outputs', function(done) {
      var tx = new Transaction();
      tx.inputs = inputs;
      tx.outputs = outputs;
      tx._checkSufficientInputs(function(err) {
        should.exist(err);
        err.message.should.equal('Insufficient inputs');
        done();
      });
    });
    it('should not give an error if inputs are greater than or equal to outputs', function(done) {
      inputs[2].output = {
        satoshis: 8000
      };

      var tx = new Transaction();
      tx.inputs = inputs;
      tx.outputs = outputs;
      tx._checkSufficientInputs(function(err) {
        should.not.exist(err);
        done();
      });      
    });
  });
});
