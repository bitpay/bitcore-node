'use strict';

var sinon = require('sinon');
var should = require('chai').should();
var Promise = require('bluebird');

var bitcore = require('bitcore');
var _ = bitcore.deps._;

var TransactionService = require('../../lib/services/transaction');

describe.only('AddressService', function() {

  it('initializes correctly', function() {
    var database = 'mock';
    var rpc = 'mock';
    var blockService = 'mock';
    var transactionService = 'mock';
    var service = new TransactionService({
      database: database,
      transactionService: transactionService,
      blockService: blockService,
      rpc: rpc
    });
    should.exist(service);
  });
});

