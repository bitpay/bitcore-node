'use strict';

var expect = require('chai').expect;
var BlockService = require('../../../lib/services/block');
var sinon = require('sinon');
var bcoin = require('bcoin');
var Block = bcoin.block;
var Encoding  = require('../../../lib/services/block/encoding');
var utils = require('../../../lib/utils');

describe('Block Service', function() {

  var blockService;
  var blocks = require('../../data/blocks.json');
  var block1 = Block.fromRaw('010000006a39821735ec18a366d95b391a7ff10dee181a198f1789b0550e0d00000000002b0c80fa52b669022c344c3e09e6bb9698ab90707bb4bb412af3fbf31cfd2163a601514c5a0c011c572aef0f0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c022003ffffffff0100f2052a01000000434104c5b694d72e601091fd733c6b18b94795c13e2db6b1474747e7be914b407854cad37cee3058f85373b9f9dbb0014e541c45851d5f85e83a1fd7c45e54423718f3ac00000000', 'hex');
  var block2 = Block.fromRaw('01000000fb3c5deea3902d5e6e0222435688795152ae0f737715b0bed6a88b00000000008ec0f92d33b05617cb3c3b4372aa0c2ae3aeb8aa7f34fe587db8e55b578cfac6b601514c5a0c011c98a831000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c027f01ffffffff0100f2052a0100000043410495fee5189566db550919ad2b4e5f9111dbdc2cb60b5c71ea4c0fdad59a961c42eb289e5b9fdc4cb3f3fec6dd866172720bae3e3b881fc203fcaf98bf902c53f1ac00000000', 'hex');

  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    blockService = new BlockService({
      node: {
        services: []
      }
    });
    blockService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#_detectReorg', function() {
    it('should detect reorg', function() {
      var block = Block.fromRaw(blocks[6], 'hex');
      blockService._tip = { hash: bcoin.util.revHex(Block.fromRaw(blocks[5], 'hex').prevBlock) };
      expect(blockService._detectReorg(block)).to.be.true;
    });

    it('should not detect reorg', function() {
      var block = Block.fromRaw(blocks[6], 'hex');
      blockService._tip = { hash: bcoin.util.revHex(Block.fromRaw(blocks[6], 'hex').prevBlock) };
      expect(blockService._detectReorg(block)).to.be.false;
    });
  });

  describe('#_findLatestValidBlockHeader', function() {

    it('should find the latest valid block header whose hash is also in our block index', function(done) {

      blockService._tip = { hash: 'aa', height: 2 };

      blockService._header = { getBlockHeader: sandbox.stub().callsArgWith(1, null, { hash: 'aa', height: 2 }) };
      blockService._findLatestValidBlockHeader(function(err, header) {

        if(err) {
          return done(err);
        }

        expect(header).to.deep.equal({ hash: 'aa', height: 2 });
        done();

      });
    });

  });

  describe('#getBestBlockHash', function() {
    it('should get best block hash', function() {
    });
  });

  describe('#getBlock', function() {
    it('should get block', function() {
    });
  });

  describe('#getBlockHashesByTimestamp', function() {
    it('should get block hashes by timestamp', function() {
    });
  });

  describe('#getBlockHeader', function() {
    it('should get block header', function() {
    });
  });

  describe('#getBlockOverview', function() {
    it('should get block overview', function() {
    });
  });

  describe('#getRawBlock', function() {
  });

  describe('#_onBlock', function() {

    it('should process blocks', function(done) {
      var getBlock = sandbox.stub(blockService, '_getBlock').callsArgWith(1, null, null);
      var processBlock = sandbox.stub(blockService, '_processBlock').callsArgWith(1, null);
      blockService._onBlock(block2, function(err) {
        if(err) {
          return done(err);
        }
        expect(processBlock.calledOnce).to.be.true;
        expect(getBlock.calledOnce).to.be.true;
        done();
      });
    });

    it('should not process blocks', function(done) {
      var getBlock = sandbox.stub(blockService, '_getBlock').callsArgWith(1, null, block2);
      var processBlock = sandbox.stub(blockService, '_processBlock');
      blockService._onBlock(block2, function(err) {
        if(err) {
          return done(err);
        }
        expect(getBlock.calledOnce).to.be.true;
        expect(processBlock.called).to.be.false;
        done();
      });
    });
  });

  describe('#_setTip', function() {

    it('should set the tip if given a block', function(done) {
      var saveTip = sandbox.stub(blockService, '_saveTip').callsArgWith(1, null);
      blockService._tip = { height: 99, hash: '00' };
      blockService._setTip({ height: 100, hash: 'aa' }, function(err) {
        if(err) {
          return done(err);
        }
        expect(blockService._tip).to.deep.equal({ height: 100, hash: 'aa' });
        done();
      });
    });

  });

  describe('#_startSync', function() {

    it('should start the sync of blocks', function() {
      blockService._header = { getLastHeader: sinon.stub().returns({ height: 100 }) };
      blockService._tip = { height: 98 };
      var sync = sandbox.stub(blockService, '_sync');
      blockService._startSync();
      expect(sync.calledOnce).to.be.true;
    });

  });

  describe('#start', function() {

    it('should get the service started', function(done) {
      var getPrefix = sandbox.stub().callsArgWith(1, null, blockService._encoding);
      var getServiceTip = sandbox.stub().callsArgWith(1, null, { height: 1, hash: 'aa' });
      var performSanityCheck = sandbox.stub(blockService, '_performSanityCheck').callsArgWith(1, null, { hash: 'aa', height: 123 });
      var loadRecentBlockHashes = sandbox.stub(blockService, '_loadRecentBlockHashes').callsArgWith(0, null, new utils.SimpleMap());
      var setTip = sandbox.stub(blockService, '_setTip').callsArgWith(1, null);
      blockService.node = { openBus: sandbox.stub() };
      blockService._db = { getPrefix: getPrefix, getServiceTip: getServiceTip };
      blockService._header = { on: sinon.stub() };
      blockService.start(function() {
        expect(blockService._encoding).to.be.an.instanceof(Encoding);
        expect(getServiceTip.calledOnce).to.be.true;
        expect(getPrefix.calledOnce).to.be.true;
        expect(setTip.calledOnce).to.be.true;
        done();
      });
    });
  });

  describe('#stop', function() {

    it('should call stop', function(done) {
      blockService.stop(done);
    });

  });

});

