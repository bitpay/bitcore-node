'use strict';

var sinon = require('sinon');
var should = require('chai').should();
var Sequelize = require('sequelize');

var bitcore = require('bitcore');

var TransactionService = require('../../lib/services/transaction');

describe('TransactionService', function() {

  var service = new TransactionService();
  var schema = sinon.stub();

  var rawTransaction = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000';
  var transactionId = '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098';

  schema.Transaction = {};
  schema.Transaction.find = sinon.stub();

  var transactionResult = sinon.stub();
  transactionResult.getDataValue = function() { return rawTransaction; };

  it('initializes correctly', function() {
    (new TransactionService()).should.exist();
  });

  describe('get', function() {
    it('allows the user to fetch a transaction using its hash', function(callback) {
      schema.Transaction.find.onFirstCall().returns({
        then: function(f) {
          return {
            then: function(g) {
              return g(f(transactionResult));
            }
          };
        }
      });

      service.getTransaction(schema, transactionId).then(function(transaction) {
        transaction.should.be.an.instanceof(bitcore.Transaction);
        transaction.toString().should.equal(rawTransaction);
        callback();
      });
    });
    it('fails on a non-string argument', function() {
      (function() {
        return service.getTransaction();
      }).should.throw(bitcore.errors.InvalidArgument);
    });
  });
});
