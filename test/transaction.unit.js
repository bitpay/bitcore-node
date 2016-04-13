'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcoinlib = require('../');
var Transaction = bitcoinlib.Transaction;

describe('Bitcoin Transaction', function() {

  describe('#populateSpentInfo', function() {
    it('will call db.getSpentInfo with correct arguments', function(done) {
      var tx = new Transaction();
      tx.to('1AGNa15ZQXAZUgFiqJ2i7Z2DPU2J6hW62i', 1000);
      tx.to('3CMNFxN1oHBc4R1EpboAL5yzHGgE611Xou', 2000);
      var expectedHash = tx.hash;
      var expectedIndex = 2;
      var expectedHeight = 300000;
      var db = {
        getSpentInfo: sinon.stub().callsArgWith(1, null, {
          txid: expectedHash,
          index: expectedIndex,
          height: expectedHeight
        })
      };
      tx.populateSpentInfo(db, {}, function(err) {
        if (err) {
          return done(err);
        }
        db.getSpentInfo.args[0][0].txid.should.equal(tx.hash);
        db.getSpentInfo.args[0][0].index.should.equal(0);
        tx.outputs[0].__spentTxId.should.equal(expectedHash);
        tx.outputs[0].__spentIndex.should.equal(expectedIndex);
        tx.outputs[0].__spentHeight.should.equal(expectedHeight);

        db.getSpentInfo.args[1][0].txid.should.equal(tx.hash);
        db.getSpentInfo.args[1][0].index.should.equal(1);
        tx.outputs[1].__spentTxId.should.equal(expectedHash);
        tx.outputs[1].__spentIndex.should.equal(expectedIndex);
        tx.outputs[1].__spentHeight.should.equal(expectedHeight);
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
    it('will skip coinbase transactions', function() {
      var tx = new Transaction();
      tx.isCoinbase = sinon.stub().returns(true);
      tx._populateInput = sinon.stub().callsArg(3);
      tx.inputs = ['input'];
      var transactions = [];
      var db = {};
      tx.populateInputs(db, transactions, function(err) {
        tx._populateInput.callCount.should.equal(0);
      });
    });
  });

  describe('#_populateInput', function() {
    var input = {
      prevTxId: new Buffer('d6cffbb343a6a41eeaa199478c985493843bfe6a59d674a5c188787416cbcda3', 'hex'),
      outputIndex: 0
    };
    it('should give an error if the input does not have a prevTxId', function(done) {
      var badInput = {};
      var tx = new Transaction();
      tx._populateInput({}, badInput, [], function(err) {
        should.exist(err);
        err.message.should.equal('Input is expected to have prevTxId as a buffer');
        done();
      });
    });
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
        getTransaction: sinon.stub().callsArgWith(1, new Error('error'))
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
        getTransaction: sinon.stub().callsArgWith(1, null, null)
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
        getTransaction: sinon.stub().callsArgWith(1, null, null)
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
    it('should set the output on the input', function(done) {
      var prevTx = new Transaction();
      prevTx.outputs = ['output'];
      var tx = new Transaction();
      var db = {
        getTransaction: sinon.stub().callsArgWith(1, null, prevTx)
      };
      tx._populateInput(db, input, [], function(err) {
        should.not.exist(err);
        input.output.should.equal('output');
        done();
      });
    });
  });

});
