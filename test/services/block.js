'use strict';

var sinon = require('sinon');
var should = require('chai').should();

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
    blockService.should.exist();
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
});
