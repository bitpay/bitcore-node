'use strict';

var expect = require('chai').expect;
var BlockService = require('../../../lib/services/block');
var BN = require('bn.js');
var assert = require('chai').assert;
var crypto = require('crypto');
var sinon = require('sinon');
var Block = require('bitcore-lib').Block;
var Encoding  = require('../../../lib/services/block/encoding');
var EventEmitter = require('events').EventEmitter;
var LRU = require('lru-cache');

describe('Block Service', function() {

  var blockService;

  beforeEach(function() {
    blockService = new BlockService({ node: { services: []}});
    blockService._chainTips = ['00'];
    blockService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  describe('#_blockAlreadyProcessed', function() {

    it('should detect that a block has already been delivered to us', function() {
      blockService._blockHeaderQueue.set('aa', {});
      expect(blockService._blockAlreadyProcessed({ hash: 'aa' })).to.be.true;
      expect(blockService._blockAlreadyProcessed('bb')).to.be.false;
      blockService._blockHeaderQueue.reset();
    });

  });

  describe('#_updateChainTips', function() {

    it('should set chain tips under normal block arrival conditions, in order arrival' , function() {

      var blocks = ['aa','bb','cc','dd','ee'];

      blocks.forEach(function(n, index) {

        var buf = new Buffer('00', 'hex');
        if (index) {
          buf = new Buffer(blocks[index-1], 'hex');
        }

        var block = { header: { prevHash: buf }, hash: n };
        blockService._updateChainTips(block, 'normal');
      });

      expect(blockService._chainTips.length).to.equal(1);
      expect(blockService._chainTips).to.deep.equal(['ee']);
    });

    it('should not set chain tips if not in normal or reorg state' , function() {

      var block = { header: { prevHash: new Buffer('aa', 'hex') }};
      blockService._updateChainTips(block, 'orphan');
      expect(blockService._chainTips).to.deep.equal(['00']);

    });

    it('should set chain tips when there is a reorg taking place' , function() {

      var block = { hash: 'ee', header: { prevHash: 'dd' } };
      blockService._updateChainTips(block, 'reorg');
      expect(blockService._chainTips).to.deep.equal(['00', 'ee']);

    });
  });

  describe('#_isOrphanBlock', function() {

    beforeEach(function() {
      var prevHash = '00000000';
      for(var i = 0; i < 110; i++) {
        var newHash = crypto.randomBytes(4);
        blockService._blockHeaderQueue.set(newHash, { prevHash: new Buffer(prevHash, 'hex') });
        prevHash = newHash;
      }
    });

    it('should detect an orphaned block', function() {
      var block = { hash: 'ee',  header: { prevHash: new Buffer('aa', 'hex') }};
      expect(blockService._isOrphanBlock(block)).to.be.true;
    });

    it('should not detect an orphaned block', function() {
      var block = { hash: 'new',  header: { prevHash: '00' }};
      expect(blockService._isOrphanBlock(block)).to.be.true;
    });

  });

  describe('#_getChainwork', function() {

    it('should get chainwork, chainwork already on header', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa', chainwork: '000000000000000000000000000000000000000000677c7b8122f9902c79f4e0'});
      blockService._blockHeaderQueue.set('aa', { prevHash: '00', chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea90'});
      var actual = blockService._getChainwork('bb');
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);

    });

    it('should get chainwork, chainwork not already on header', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa', bits: 0x18018d30 });
      blockService._blockHeaderQueue.set('aa', { prevHash: '00', chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea90'});
      var actual = blockService._getChainwork('bb');
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);

    });
  });


  describe('#_computeChainwork', function() {

    it('should calculate chain work correctly', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      var prev = new BN(new Buffer('000000000000000000000000000000000000000000677bd68118a98f8779ea90', 'hex'));

      var actual = blockService._computeChainwork(0x18018d30, prev);
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);
    });

  });

  describe('#_selectActiveChain', function() {

    it('should select active chain based on most chain work', function() {
      blockService._blockHeaderQueue.set('cc', { prevHash: '00', bits: 0x18018d30 });
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa', bits: 0x18018d30 });
      blockService._blockHeaderQueue.set('aa', { chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea90'});
      blockService._blockHeaderQueue.set('00', { chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea8f'});
      blockService._chainTips.push('bb');
      blockService._chainTips.push('cc');

      var expected = 'bb';
      var actual = blockService._selectActiveChain();
      expect(actual).to.equal(expected);
    });

  });

  describe('#_cacheBlock', function() {

    it('should set the block in the block queue and db', function() {
      var sandbox = sinon.sandbox.create();
      var spy1 = sandbox.spy();
      var stub1 = sandbox.stub();
      blockService._blockQueue = { set: stub1 };
      var block = {};
      sandbox.stub(blockService, '_getBlockOperations');
      blockService._db = { batch: spy1 };
      blockService._cacheBlock(block);
      expect(spy1.calledOnce).to.be.true;
      expect(stub1.calledOnce).to.be.true;
      sandbox.restore();
    });

  });

  describe('#_isChainReorganizing', function() {

    it('should decide that chain is reorging', function() {
      blockService._tip = { hash: 'aa' };
      var block = { header: { prevHash: new Buffer('00', 'hex') }};
      expect(blockService._isChainReorganizing(block)).to.be.true;
    });

    it('should decide that chain is not reorging', function() {
      blockService._tip = { hash: 'aa' };
      var block = { header: { prevHash: new Buffer('aa', 'hex') }};
      expect(blockService._isChainReorganizing(block)).to.be.false;
    });

  });

  describe('#_getBlockOperations', function() {

    it('should get block operations when given one block', function() {
      var block = new Block(new Buffer('0100000095194b8567fe2e8bbda931afd01a7acd399b9325cb54683e64129bcd00000000660802c98f18fd34fd16d61c63cf447568370124ac5f3be626c2e1c3c9f0052d19a76949ffff001d33f3c25d0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d014dffffffff0100f2052a01000000434104e70a02f5af48a1989bf630d92523c9d14c45c75f7d1b998e962bff6ff9995fc5bdb44f1793b37495d80324acba7c8f537caaf8432b8d47987313060cc82d8a93ac00000000', 'hex'));
      var ops = blockService._getBlockOperations(block);

      expect(ops[0]).to.deep.equal({ type: 'put', key: blockService._encoding.encodeBlockKey(block.hash), value: blockService._encoding.encodeBlockValue(block) });

    });

    it('should get block operations when given more than one block', function() {
      var block = new Block(new Buffer('0100000095194b8567fe2e8bbda931afd01a7acd399b9325cb54683e64129bcd00000000660802c98f18fd34fd16d61c63cf447568370124ac5f3be626c2e1c3c9f0052d19a76949ffff001d33f3c25d0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d014dffffffff0100f2052a01000000434104e70a02f5af48a1989bf630d92523c9d14c45c75f7d1b998e962bff6ff9995fc5bdb44f1793b37495d80324acba7c8f537caaf8432b8d47987313060cc82d8a93ac00000000', 'hex'));
      var ops = blockService._getBlockOperations([block, block]);

      expect(ops[0]).to.deep.equal({ type: 'put', key: blockService._encoding.encodeBlockKey(block.hash), value: blockService._encoding.encodeBlockValue(block) });
      expect(ops[1]).to.deep.equal({ type: 'put', key: blockService._encoding.encodeBlockKey(block.hash), value: blockService._encoding.encodeBlockValue(block) });

    });

  });

  describe('#_onBlock', function() {

    it('should perform all the steps for onBlock handler (normal)', function() {

      var sandbox = sinon.sandbox.create();
      var alreadyProcessed = sandbox.stub(blockService, '_blockAlreadyProcessed').returns(false);
      var cacheBlock = sandbox.stub(blockService, '_cacheBlock');
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('normal');
      var updateChainTips = sandbox.stub(blockService, '_updateChainTips');
      var sendAllUnsent = sandbox.stub(blockService, '_sendDelta');

      blockService._onBlock({ hash: 'aa' });
      expect(alreadyProcessed.callCount).to.equal(1);
      expect(cacheBlock.callCount).to.equal(1);
      expect(blockState.callCount).to.equal(1);
      expect(updateChainTips.callCount).to.equal(1);
      expect(sendAllUnsent.callCount).to.equal(1);

      sandbox.restore();

    });

    it('should perform all the steps for onBlock handler (reorg)', function() {

      var sandbox = sinon.sandbox.create();
      var block = { hash: 'aa' };
      var alreadyProcessed = sandbox.stub(blockService, '_blockAlreadyProcessed').returns(false);
      var cacheBlock = sandbox.stub(blockService, '_cacheBlock');
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('reorg');
      var updateChainTips = sandbox.stub(blockService, '_updateChainTips');

      var reorgListener = blockService.on('reorg', function(block) {
        expect(block).to.equal(block);
      });

      blockService._onBlock(block);
      expect(alreadyProcessed.callCount).to.equal(1);
      expect(cacheBlock.callCount).to.equal(1);
      expect(blockState.callCount).to.equal(1);
      expect(updateChainTips.callCount).to.equal(1);

      sandbox.restore();

    });

    it('should perform all the steps for onBlock handler (orphaned)', function() {

      var sandbox = sinon.sandbox.create();
      var alreadyProcessed = sandbox.stub(blockService, '_blockAlreadyProcessed').returns(false);
      var cacheBlock = sandbox.stub(blockService, '_cacheBlock');
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('orphaned');
      var updateChainTips = sandbox.stub(blockService, '_updateChainTips');

      blockService._onBlock({ hash: 'aa' });
      expect(alreadyProcessed.callCount).to.equal(1);
      expect(cacheBlock.callCount).to.equal(1);
      expect(blockState.callCount).to.equal(1);
      expect(updateChainTips.callCount).to.equal(1);

      sandbox.restore();

    });
  });

  describe('#_determineBlockState', function() {

    it('should determine the block in a normal state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(false);
      var stub2 = sandbox.stub(blockService, '_isOrphanBlock').returns(false);
      expect(blockService._determineBlockState({})).to.equal('normal');
      sandbox.restore();
    });

    it('should determine the block in a orphan state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(false);
      var stub2 = sandbox.stub(blockService, '_isOrphanBlock').returns(true);
      expect(blockService._determineBlockState({})).to.equal('orphaned');
      sandbox.restore();
    });

    it('should determine the block in a reorg state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(true);
      var stub2 = sandbox.stub(blockService, '_isOrphanBlock').returns(false);
      expect(blockService._determineBlockState({})).to.equal('reorg');
      sandbox.restore();
    });

  });

  describe('#start', function() {

    var sandbox;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      blockService._db = {
        getPrefix: sandbox.stub().callsArgWith(1, null, new Buffer('0000', 'hex')) };
      var setListeners = sandbox.stub(blockService, '_setListeners');
    });

    after(function() {
      sandbox.restore();
    });

    it('should get the prefix', function(done) {
      blockService.start(function() {
        expect(blockService._encoding).to.be.an.instanceof(Encoding);
        done();
      });
    });
  });

  describe('#stop', function() {

    it('should call stop', function(done) {
      blockService.stop(done);
    });

  });

  describe('#_loadTip', function() {

    var tip = { hash: 'aa', height: 1 };
    var sandbox;
    var testEmitter = new EventEmitter();

    beforeEach(function() {
      sandbox = sinon.sandbox.create();

      blockService._db = {

        getServiceTip: function(name) {
          testEmitter.emit('tip-' + name, tip);
        }

      };
    });

    after(function() {
      sandbox.restore();
    });

    it('should load the tip from the db service', function() {
      testEmitter.on('tip-block', function(_tip) {
        expect(_tip).to.deep.equal(tip);
      });
      blockService._loadTip();
    });
  });

  describe('#_sendDelta', function() {

    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should send all unsent blocks for the active chain', function() {
      var activeChain = sandbox.stub(blockService, '_selectActiveChain').returns('aa');
      var checkChain = sandbox.stub(blockService, '_checkChain').returns(true);
      var getDelta = sandbox.stub(blockService, '_getDelta').returns(['aa', '00']);
      var broadcast = sandbox.stub(blockService, '_broadcast');
      var setTip = sandbox.stub(blockService, '_setTip');

      blockService._sendDelta();
      expect(activeChain.calledOnce).to.be.true;
      expect(checkChain.calledOnce).to.be.true;
      expect(getDelta.calledOnce).to.be.true;
      expect(broadcast.calledTwice).to.be.true;
      expect(setTip.calledOnce).to.be.true;
    });
  });

  describe('#_getDelta', function() {

    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should get all unsent blocks for the active chain', function() {

      var expected = [ 'block bb', 'block cc' ];
      blockService._tip = { hash: 'aa' };
      blockService._blockHeaderQueue = LRU(5);
      blockService._blockQueue = LRU(5);
      blockService._blockHeaderQueue.set('cc', { prevHash: 'bb' });
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa' });
      blockService._blockQueue.set('bb', 'block cc');
      blockService._blockQueue.set('aa', 'block 00');
      blockService._blockQueue.set('cc', 'block bb');
      var actual = blockService._getDelta('cc');
      expect(actual).to.deep.equal(expected);
    });
  });

  describe('#_checkChain', function() {

    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should check that blocks between the active chain tip and the block service tip are in the same chain and the chain is complete.', function() {

      blockService._tip = { hash: 'aa' };
      blockService._blockHeaderQueue = LRU(5);
      blockService._blockQueue = LRU(5);
      blockService._blockHeaderQueue.set('cc', { prevHash: 'bb' });
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa' });
      blockService._blockQueue.set('bb', 'block cc');
      blockService._blockQueue.set('cc', 'block bb');
      var result = blockService._checkChain('cc');
      expect(result).to.be.true;
      blockService._blockQueue.reset();
      blockService._blockHeaderQueue.reset();
    });

    it('should check that blocks between the active chain tip and the block service tip are in a different chain.', function() {

      blockService._tip = { hash: 'aa' };
      blockService._blockHeaderQueue = LRU(5);
      blockService._blockQueue = LRU(5);
      blockService._blockHeaderQueue.set('cc', { prevHash: 'xx' });
      blockService._blockHeaderQueue.set('bb', { prevHash: 'aa' });
      blockService._blockQueue.set('bb', 'block cc');
      blockService._blockQueue.set('cc', 'block bb');
      var result = blockService._checkChain('cc');
      expect(result).to.be.false;
    });
  });
});

