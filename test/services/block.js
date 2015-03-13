'use strict';

var sinon = require('sinon');
var should = require('chai').should();
var Promise = require('bluebird');

var bitcore = require('bitcore');

var BlockService = require('../../lib/services/block');

describe('BlockService', function() {

  it('initializes correctly', function() {
    var database = 'database';
    var rpc = 'rpc';
    var txService = 'txService';
    var blockService = new BlockService({
      database: database,
      rpc: 'rpc',
      transactionService: 'txService'
    });
    should.exist(blockService);
    blockService.database.should.equal(database);
    blockService.rpc.should.equal(rpc);
    blockService.transactionService.should.equal(txService);
  });

  describe('getBlock', function() {

    var mockRpc, transactionMock, database, blockService;
    
    beforeEach(function() {
      database = sinon.mock();
      mockRpc = sinon.mock();
      transactionMock = sinon.mock();

      mockRpc.getBlockAsync = function(block) {
        return Promise.resolve({
          result: {
            hash: '000000006a625f06636b8bb6ac7b960a8d03705d1ace08b1a19da3fdcc99ddbd',
            confirmations: 347064,
            size: 215,
            height: 2,
            version: 1,
            merkleRoot: '9b0fc92260312ce44e74ef369f5c66bbb85848f2eddd5a7a1cde251e54ccfdd5',
            tx: [ '9b0fc92260312ce44e74ef369f5c66bbb85848f2eddd5a7a1cde251e54ccfdd5' ],
            time: 1231469744,
            nonce: 1639830024,
            bits: '1d00ffff',
            previousblockhash: '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048'
          }
        });
      };

      transactionMock.getTransaction = function(txId) {
        return Promise.resolve(
          '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d010bffffffff0100f2052a010000004341047211a824f55b505228e4c3d5194c1fcfaa15a456abdf37f9b9d97a4040afc073dee6c89064984f03385237d92167c13e236446b417ab79a0fcae412ae3316b77ac00000000'
        );
      };

      blockService = new BlockService({
        rpc: mockRpc,
        transactionService: transactionMock,
        database: database
      });
    }); 

    it('retrieves correctly a block, uses RPC', function(callback) {

      var hash = '000000006a625f06636b8bb6ac7b960a8d03705d1ace08b1a19da3fdcc99ddbd';

      blockService.getBlock(hash).then(function(block) {
        block.hash.should.equal(hash);
        callback();
      });

    });

  });

  describe('block confirmation', function() {

    var mockRpc, transactionMock, database, blockService, writeLock;

    var thenCaller = {
      then: function(arg) {
        return arg();
      }
    };
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
    
    beforeEach(function() {
      database = sinon.mock();
      mockRpc = sinon.mock();
      transactionMock = sinon.mock();

      blockService = new BlockService({
        rpc: mockRpc,
        transactionService: transactionMock,
        database: database
      });
      blockService.writeLock = sinon.mock();
      blockService.getBlock = sinon.mock();
    }); 

    it('makes the expected calls when confirming the genesis block', function(callback) {
      database.batchAsync = function(ops) {
        ops.should.deep.equal([
          { type: 'put',
            key: 'nxt-0000000000000000000000000000000000000000000000000000000000000000',
            value: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' },
          { type: 'put',
            key: 'prev-000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
            value: '0000000000000000000000000000000000000000000000000000000000000000' },
          { type: 'put',
            key: 'bh-000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
            value: 0 },
          { type: 'put',
            key: 'bts-1231006505',
            value: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' }
        ]);
        return thenCaller;
      };
      blockService.unlock = callback;
      blockService.writeLock.onFirstCall().returns(thenCaller);
      database.getAsync = function() {
        return Promise.reject({notFound: true});
      };
      transactionMock._confirmTransaction = sinon.mock();
      blockService._confirmBlock(genesisBlock);
    });
  });
});
