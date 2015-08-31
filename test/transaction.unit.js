'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcoinlib = require('../');
var Transaction = bitcoinlib.Transaction;
var levelup = require('levelup');

describe('Bitcoin Transaction', function() {
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
});
