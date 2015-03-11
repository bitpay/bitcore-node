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
    should.exist(service);
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

  describe('transaction confirmation', function() {

    var database, rpc, service;

    beforeEach(function() {
      database = sinon.mock();
      rpc = sinon.mock();
      service = new TransactionService({
        rpc: rpc,
        database: database
      });
    });

    var genesisBlock = new bitcore.Block(
      new Buffer(
        '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a'
        +'7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c010'
        +'1000000010000000000000000000000000000000000000000000000000000000000000000ffffffff'
        +'4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f7'
        +'2206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffff'
        +'ff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0e'
        +'a1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000'
      , 'hex')
    );
    genesisBlock.height = 0;
    var genesisTx = genesisBlock.transactions[0];

    it('confirms correctly the first transaction on genesis block', function(callback) {
      var ops = [];
      service._confirmTransaction(ops, genesisBlock, genesisTx).then(function() {
        ops.should.deep.equal([
          { type: 'put',
            key: 'btx-4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            value: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' },
          { type: 'put',
            key: 'txo-4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b-0',
            value: 
            { satoshis: 5000000000,
              script: '65 0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f OP_CHECKSIG' } },
          { type: 'put',
            key: 'txa-1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
            value: 
            { satoshis: 5000000000,
              script: '65 0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f OP_CHECKSIG' } }
        ]);
        callback();
      });
    });
  });
});
