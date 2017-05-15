'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var TransactionService = require('../../../lib/services/transaction');
var levelup = require('levelup');

describe('Transaction Index', function() {

  describe('Failures', function() {
    //if we miss indexing a tx, then this is very bad news. We have no good way of
    //recursively retrieving inputValues, timestamp of its block, and block's height
    it('should throw error if a transaction is not in the index', function(done) {
      var services = {
        db: {
          store: {
            get: sinon.stub().callsArgWith(1, new levelup.errors.NotFoundError())
          }
        }
      };
      var node = { node: { services: services }};
      var service = new TransactionService(node);

      service.encoding = { encodeTransactionKey: function() { return 'key'; }};
      var tx = service.getTransaction('1234', {}, function(err, res) {
        err.should.be.an.instanceof(Error);
        err.message.should.equal('Transaction: 1234 not found in index');
        done();
      });
    });

    it('should search the mempool if opted for', function(done) {
      var getTransaction =  sinon.stub().callsArgWith(1, new levelup.errors.NotFoundError());
      var services = {
        db: {
          store: {
            get: sinon.stub().callsArgWith(1, new levelup.errors.NotFoundError())
          }
        },
        mempool: {
          getTransaction: getTransaction
        }
      };
      var node = { node: { services: services }};
      var service = new TransactionService(node);

      service.encoding = { encodeTransactionKey: function() { return 'key'; }};
      var tx = service.getTransaction('1234', { queryMempool: true }, function(err, res) {
        err.should.be.an.instanceof(Error);
        err.message.should.equal('Transaction: 1234 not found in index or mempool');
        done();
      });

    });
  });

  describe('Success', function() {
    it('should search main index', function(done) {
      var services = {
        db: {
          store: {
            get: sinon.stub().callsArgWith(1, null, 'tx')
          }
        }
      };
      var node = { node: { services: services }};
      var service = new TransactionService(node);

      service.encoding = {
        encodeTransactionKey: function() { return 'key'; },
        decodeTransactionValue: function() { return 'value'; }
      };
      var tx = service.getTransaction('1234', {}, function(err, res) {
        if(err) {
          return done(err);
        }
        res.should.equal('value');
        done();
      });

    });

    it('should search mempool', function(done) {
      var missingInputs = sinon.stub().callsArgWith(1, null, 'tx');
      var getTransaction = sinon.stub().callsArgWith(1, null, 'tx');
      var services = {
        db: {
          store: {
            get: sinon.stub().callsArgWith(1, new levelup.errors.NotFoundError())
          }
        },
        mempool: {
          getTransaction: getTransaction
        }
      };
      var node = { node: { services: services }};
      var service = new TransactionService(node);

      service.encoding = {
        encodeTransactionKey: function() { return 'key'; }
      };
      service._getMissingInputValues = missingInputs;
      var tx = service.getTransaction('1234', { queryMempool: true }, function(err, res) {
        if(err) {
          return done(err);
        }
        missingInputs.callCount.should.equal(1);
        res.should.equal('tx');
        done();
      });
    });
  });
});

