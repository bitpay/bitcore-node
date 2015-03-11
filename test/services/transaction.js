'use strict';

var sinon = require('sinon');
var should = require('chai').should();
var Promise = require('bluebird');

var bitcore = require('bitcore');

var TransactionService = require('../../lib/services/transaction');

describe('TransactionService', function() {

  var rawTransaction = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000';
  var transactionId = '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e68bebb44a74b1efd512098';

  it('initializes correctly', function() {
    var database = 'mock';
    var rpc = 'mock';
    var service = new TransactionService({
      database: database,
      rpc: rpc
    });
    service.should.exist;
  });

  describe('get', function() {

    var database, rpc, service;

    beforeEach(function() {
      database = sinon.mock();
      rpc = sinon.mock();
      rpc.getRawTransactionAsync = function(transaction) {
        return Promise.resolve({
          result: rawTransaction
        });
      };
      service = new TransactionService({
        rpc: rpc,
        database: database
      });
    });

    it('allows the user to fetch a transaction using its hash', function(callback) {

      service.getTransaction(transactionId).then(function(transaction) {
        transaction.hash.should.equal(transactionId);
        callback();
      });
    });
  });
});
