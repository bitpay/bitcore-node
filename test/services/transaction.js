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

    var genesisBlock = require('../data/genesis');
    genesisBlock.height = 0;
    var genesisTx = genesisBlock.transactions[0];

    it('confirms correctly the first transaction on genesis block', function(callback) {
      var ops = [];
      service._confirmTransaction(ops, genesisBlock, genesisTx).then(function() {
        var opsObj = ops.map(function(k) {
          if (bitcore.util.js.isValidJSON(k.value)) {
            k.value = JSON.parse(k.value);
          }
          return k;
        });
        opsObj.should.deep.equal([{
          type: 'put',
          key: 'btx-4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
          value: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
        }, {
          type: 'put',
          key: 'txo-4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b-0',
          value: {
            satoshis: 5000000000,
            script: '65 0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909' +
              'a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7b' +
              'a0b8d578a4c702b6bf11d5f OP_CHECKSIG'
          }
        }]);
        callback();
      });
    });

    var block170 = require('../data/170');

    it('confirms correctly the first non-coinbase transaction (block 170)', function(callback) {
      var ops = [];
      service.getTransaction = sinon.stub();
      var firstTxSpent = require('../data/firstTxSpent');
      service.getTransaction.onFirstCall().returns({
        then: function(arg) {
          return arg(firstTxSpent);
        }
      });
      service._confirmTransaction(ops, block170, block170.transactions[1]).then(function() {
        ops.should.deep.equal([{
          type: 'put',
          key: 'btx-f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
          value: '00000000d1145790a8694403d4063f323d499e655c83426834d4ce2f8dd4a2ee'
        }, {
          type: 'put',
          key: 'txo-f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16-0',
          value: '{"satoshis":1000000000,"script":"65 0x04ae1a62fe09c5f51b13905f07f06b99a2f7159b2225f374cd378d71302fa28414e7aab37397f554a7df5f142c21c1b7303b8a0626f1baded5c72a704f7e6cd84c OP_CHECKSIG"}'
        }, {
          type: 'put',
          key: 'txo-f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16-1',
          value: '{"satoshis":4000000000,"script":"65 0x0411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3 OP_CHECKSIG"}'
        }, {
          type: 'put',
          key: 'txo-f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16-0',
          value: '{"prevTxId":"0437cd7f8525ceed2324359c2d0ba26006d92d856a9c20fa0241106ee5a597c9","outputIndex":0,"sequenceNumber":4294967295,"script":"47304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901","scriptString":"71 0x304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901","heightConfirmed":170}'
        }]);
        /* TODO: This should work if address spent is accepted for public key. Add test for P2PKH if not accepted
         * { type: 'put',
          key: 'txas-12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S-f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16-0',
          value: 
          { heightSpent: 170,
            spentTx: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
            spentTxInputIndex: 0,
            spendInput: { prevTxId: '0437cd7f8525ceed2324359c2d0ba26006d92d856a9c20fa0241106ee5a597c9',
              outputIndex: 0,
              sequenceNumber: 4294967295,
              script: '71 0x304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901' }}}]);*/
        callback();
      });
    });
  });
});
