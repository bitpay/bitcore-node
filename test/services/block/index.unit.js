'use strict';

var expect = require('chai').expect;
var BlockService = require('../../../lib/services/block');
var BN = require('bn.js');
var assert = require('chai').assert;
var crypto = require('crypto');
var sinon = require('sinon');
var Block = require('bitcore-lib').Block;
var Encoding  = require('../../../lib/services/block/encoding');
var LRU = require('lru-cache');
var constants = require('../../../lib/constants');

describe('Block Service', function() {

  var blockService;

  beforeEach(function() {
    blockService = new BlockService({
      node: {
        getNetworkName: function() { return 'regtest'; },
        services: []
      }
    });
    blockService._chainTips = ['00'];
    blockService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  describe('#_blockAlreadyProcessed', function() {

    it('should detect that a block has already been delivered to us', function() {
      blockService._blockQueue = LRU(1);
      blockService._blockQueue.set('aa', '00');
      expect(blockService._blockAlreadyProcessed({ hash: 'aa' })).to.be.true;
      expect(blockService._blockAlreadyProcessed('bb')).to.be.false;
      blockService._blockQueue.reset();
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

  describe('#_computeChainwork', function() {

    it('should calculate chain work correctly', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      var prev = new BN(new Buffer('000000000000000000000000000000000000000000677bd68118a98f8779ea90', 'hex'));

      var actual = blockService._computeChainwork(0x18018d30, prev);
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);
    });

  });

  describe('#_determineBlockState', function() {

    it('should determine the block in a normal state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(false);
      var stub2 = sandbox.stub(blockService, '_isOutOfOrder').returns(false);
      expect(blockService._determineBlockState({})).to.equal('normal');
      sandbox.restore();
    });

    it('should determine the block in a outoforder state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(false);
      var stub2 = sandbox.stub(blockService, '_isOutOfOrder').returns(true);
      expect(blockService._determineBlockState({})).to.equal('outoforder');
      sandbox.restore();
    });

    it('should determine the block in a reorg state', function() {
      var sandbox = sinon.sandbox.create();
      var stub1 = sandbox.stub(blockService, '_isChainReorganizing').returns(true);
      var stub2 = sandbox.stub(blockService, '_isOutOfOrder').returns(false);
      expect(blockService._determineBlockState({})).to.equal('reorg');
      sandbox.restore();
    });

  });

  describe('#_findCommonAncestor', function() {
    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should find the common ancestor between the current chain and the new chain', function() {
      var block = { hash: 'cc' };
      blockService._tip = { hash: 'bb' }
      blockService._blockQueue = new LRU(5);
      blockService._blockQueue.set('aa', { prevHash: '00' });
      blockService._blockQueue.set('bb', { prevHash: 'aa' });
      blockService._blockQueue.set('cc', { prevHash: 'aa' });
      blockService._chainTips = [ 'cc', 'bb' ];
      var commonAncestor = blockService._findCommonAncestor(block);
      expect(commonAncestor).to.equal('aa');
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

  describe('#getBlockOverview', function() {
    it('should get block overview', function() {
    });
  };

  describe('#_getChainwork', function() {

    it('should get chainwork', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      blockService._meta = [ { chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea90', hash: 'aa' } ];
      blockService._blockQueue = LRU(1);
      blockService._blockQueue.set('bb', { header: { bits: 0x18018d30 }});
      var actual = blockService._getChainwork('bb');
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);
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

      var block1 = { header: { prevHash: new Buffer('00', 'hex') }};
      var block2 = { header: { prevHash: new Buffer('aa', 'hex') }};
      var block3 = { header: { prevHash: new Buffer('bb', 'hex') }};
      var expected = [ block2, block3 ];
      blockService._tip = { hash: 'aa' };
      blockService._blockQueue = LRU(3);
      blockService._blockQueue.set('aa', block1);
      blockService._blockQueue.set('bb', block2);
      blockService._blockQueue.set('cc', block3);
      var actual = blockService._getDelta('cc');
      expect(actual).to.deep.equal(expected);
    });
  });

  describe('#getRawBlock', function() {
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

  describe('#_isOutOfOrder', function() {

    beforeEach(function() {
      var prevHash = '00000000';
      for(var i = 0; i < 110; i++) {
        var newHash = crypto.randomBytes(4);
        var mock = { toBuffer: function() { return new Buffer(new Array(10), 'hex') } };
        blockService._blockQueue.set(newHash, mock);
        prevHash = newHash;
      }
    });

    it('should detect an orphaned block', function() {
      var block = { hash: 'ee',  header: { prevHash: new Buffer('aa', 'hex') }};
      expect(blockService._isOutOfOrder(block)).to.be.true;
    });

    it('should not detect an orphaned block', function() {
      var block = { hash: 'new',  header: { prevHash: '00' }};
      expect(blockService._isOutOfOrder(block)).to.be.true;
    });

  });


  describe('#_onBestHeight', function() {
    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should set best height', function() {
      var startSync = sandbox.stub(blockService, '_startSync');
      blockService._onBestHeight(123);
      expect(blockService._bestHeight).to.equal(123);
      expect(startSync.calledOnce).to.be.true;
    });

  });

  describe('#_onBlock', function() {

    it('should perform all the steps for onBlock handler (normal)', function() {

      var sandbox = sinon.sandbox.create();
      var alreadyProcessed = sandbox.stub(blockService, '_blockAlreadyProcessed').returns(false);
      var cacheBlock = sandbox.stub(blockService, '_cacheBlock');
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('normal');
      var updateChainTips = sandbox.stub(blockService, '_updateChainInfo');
      var sendAllUnsent = sandbox.stub(blockService, '_sendDelta');
      var saveMetaData  = sandbox.stub(blockService, '_saveMetaData');

      blockService._onBlock({ hash: 'aa' });
      expect(alreadyProcessed.callCount).to.equal(1);
      expect(cacheBlock.callCount).to.equal(1);
      expect(blockState.callCount).to.equal(1);
      expect(updateChainTips.callCount).to.equal(1);
      expect(sendAllUnsent.callCount).to.equal(1);
      expect(saveMetaData.callCount).to.equal(1);

      sandbox.restore();

    });

    it('should perform all the steps for onBlock handler (reorg)', function() {

      var sandbox = sinon.sandbox.create();
      var block = { hash: 'aa' };
      var alreadyProcessed = sandbox.stub(blockService, '_blockAlreadyProcessed').returns(false);
      var cacheBlock = sandbox.stub(blockService, '_cacheBlock');
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('reorg');
      var updateChainTips = sandbox.stub(blockService, '_updateChainInfo');

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
      var blockState = sandbox.stub(blockService, '_determineBlockState').returns('outoforder');
      var updateChainTips = sandbox.stub(blockService, '_updateChainInfo');

      blockService._onBlock({ hash: 'aa' });
      expect(alreadyProcessed.callCount).to.equal(1);
      expect(cacheBlock.callCount).to.equal(1);
      expect(blockState.callCount).to.equal(1);
      expect(updateChainTips.callCount).to.equal(1);

      sandbox.restore();

    });
  });

  describe('#_onDbError', function() {
    it('should handle db errors', function() {
      var stop = sinon.stub();
      blockService.node = { stop: stop };
      expect(stop.calledOnce);
    });
  });


  describe('#_selectActiveChain', function() {

    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should select active chain based on most chain work', function() {
      blockService._chainTips = [ 'aa', 'cc' ];

      var getCW = sandbox.stub(blockService, '_getChainwork');
      getCW.onCall(0).returns(new BN(1));
      getCW.onCall(1).returns(new BN(2));
      var expected = 'cc';
      var actual = blockService._selectActiveChain();
      expect(actual).to.equal(expected);
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
      blockService._meta = [ { hash: 'aa' } ];
      var activeChain = sandbox.stub(blockService, '_selectActiveChain').returns('aa');
      var getDelta = sandbox.stub(blockService, '_getDelta').returns(['aa', '00']);
      var broadcast = sandbox.stub(blockService, '_broadcast');
      var setTip = sandbox.stub(blockService, '_setTip');

      blockService._sendDelta();
      expect(activeChain.calledOnce).to.be.true;
      expect(getDelta.calledOnce).to.be.true;
      expect(broadcast.calledTwice).to.be.true;
      expect(setTip.calledOnce).to.be.true;
    });
  });

  describe('#_setListeners', function() {

    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();

    });

    after(function() {
      sandbox.restore();
    });

    it('should set listeners for bestHeight, db error and reorg', function() {
      var bestHeight = sandbox.stub();
      var dbError = sandbox.stub();
      var on = sandbox.stub(blockService, 'on');

      blockService._p2p = { once: bestHeight };
      blockService._db = { on: dbError };

      blockService._setListeners();
      expect(bestHeight.calledOnce).to.be.true;
      expect(dbError.calledOnce).to.be.true;
      expect(on.calledOnce).to.be.true;

    });
  });

  describe('#_setTip', function() {

    it('should set the tip if given a block', function() {
      var stub = sinon.stub();
      blockService._db = {};
      blockService._db.setServiceTip = stub;
      blockService._tip = { height: 99, hash: '00' };
      blockService._setTip({ height: 100, hash: 'aa' });
      expect(stub.calledOnce).to.be.true;
    });

  });

  describe('#_startSubscriptions', function() {
    it('should start the subscriptions if not already subscribed', function() {
      var on = sinon.stub();
      var subscribe = sinon.stub();
      var openBus = sinon.stub().returns({ on: on, subscribe: subscribe });
      blockService.node = { openBus: openBus };
      blockService._startSubscriptions();
      expect(blockService._subscribed).to.be.true;
      expect(openBus.calledOnce).to.be.true;
      expect(on.calledOnce).to.be.true;
      expect(subscribe.calledOnce).to.be.true;
    });
  });

  describe('#_startSync', function() {
    var sandbox;
    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      blockService.node.getNetworkName = function() { return 'regtest'; };
      blockService._tip = { height: 100 };
      blockService._bestHeight = 201;
    });

    after(function() {
      sandbox.restore();
    });

    it('should start the sync of blocks if type set', function() {
      var stub = sandbox.stub(blockService, '_sync');
      blockService._startSync();
      expect(stub.calledOnce).to.be.true;
      expect(blockService._latestBlockHash).to.equal(constants.BITCOIN_GENESIS_HASH[blockService.node.getNetworkName()]);
      expect(blockService._p2pBlockCallsNeeded).to.equal(1);
    });
  });

  describe('#_sync', function() {
    it('should sync blocks', function() {
       blockService._p2pBlockCallsNeeded = 2;
       var getBlocks = sinon.stub();
       blockService._p2p = { getBlocks: getBlocks };
       blockService._sync();
       expect(blockService._p2pBlockCallsNeeded).to.equal(1);
       expect(getBlocks.calledOnce).to.be.true;
    });
  });


  describe('#start', function() {

    var sandbox;
    var getServiceTip;
    var getServicePrefix;
    var loadMeta;
    var startSubs;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      getServiceTip = sandbox.stub().callsArgWith(1, null, { height: 100, hash: 'aa' });
      getServicePrefix = sandbox.stub().callsArgWith(1, null, new Buffer('0000', 'hex'));
      loadMeta = sandbox.stub(blockService, '_loadMeta').callsArgWith(0, null);
      startSubs = sandbox.stub(blockService, '_startSubscriptions');

      blockService._db = {
        getPrefix: getServicePrefix,
        getServiceTip: getServiceTip
      };
      var setListeners = sandbox.stub(blockService, '_setListeners');
    });

    after(function() {
      sandbox.restore();
    });

    it('should get the prefix', function(done) {
      blockService.start(function() {
        expect(blockService._encoding).to.be.an.instanceof(Encoding);
        expect(getServiceTip.calledOnce).to.be.true;
        expect(getServicePrefix.calledOnce).to.be.true;
        expect(loadMeta.calledOnce).to.be.true;
        expect(startSubs.calledOnce).to.be.true;
        done();
      });
    });
  });

  describe('#stop', function() {

    it('should call stop', function(done) {
      blockService.stop(done);
    });

  });

  describe('#_updateChainInfo', function() {

    var sandbox;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
    });

    after(function() {
      sandbox.restore();
    });

    it('should update chain tips and incomplete block list for the out of order state', function() {
      var stub = sandbox.stub(blockService, '_updateOutOfOrderStateChainInfo');
      blockService._updateChainInfo({ header: { prevHash: new Buffer('aa', 'hex')}}, 'outoforder');
      expect(stub.calledOnce).to.be.true;
    });

    it('should update chain tips and incomplete block list for normal state', function() {
      var stub = sandbox.stub(blockService, '_updateNormalStateChainInfo');
      blockService._updateChainInfo({ header: { prevHash: new Buffer('aa', 'hex')}}, 'normal');
      expect(stub.calledOnce).to.be.true;
    });

    it('should update chain tips and incomplete block list for reorg state', function() {
      var stub = sandbox.stub(blockService, '_updateReorgStateChainInfo');
      blockService._updateChainInfo({ header: { prevHash: new Buffer('aa', 'hex')}}, 'reorg');
      expect(stub.calledOnce).to.be.true;
    });
  });


  describe('#_updateOutOfOrderStateChainInfo', function() {

    var block1 = { hash: 'aa', header: { prevHash: new Buffer('99', 'hex') } };
    var block2 = { hash: 'bb', header: { prevHash: new Buffer('aa', 'hex') } };
    var block3 = { hash: 'cc', header: { prevHash: new Buffer('bb', 'hex') } };
    var block4 = { hash: 'dd', header: { prevHash: new Buffer('cc', 'hex') } };
    var block5 = { hash: 'ee', header: { prevHash: new Buffer('dd', 'hex') } };
    var block6_1 = { hash: '11', header: { prevHash: new Buffer('ee', 'hex') } };
    var block6 = { hash: 'ff', header: { prevHash: new Buffer('ee', 'hex') } };

    it('should join chains if needed', function() {

      blockService._incompleteChains = [ [block6, block5], [block3, block2] ];
      blockService._updateOutOfOrderStateChainInfo(block4);
      expect(blockService._incompleteChains).to.deep.equal([ [ block6, block5, block4, block3, block2] ]);

    });

    it('should join chains if needed different order', function() {

      blockService._incompleteChains = [ [block3, block2], [block6, block5] ];
      blockService._updateOutOfOrderStateChainInfo(block4);
      expect(blockService._incompleteChains).to.deep.equal([ [ block6, block5, block4, block3, block2] ]);

    });

    it('should not join chains', function() {
      blockService._incompleteChains = [ [block2, block1], [block6, block5] ];
      blockService._updateOutOfOrderStateChainInfo(block4);
      expect(blockService._incompleteChains).to.deep.equal([ [ block2, block1 ], [ block6, block5, block4 ] ]);
    });

    it('should not join chains, only add a new chain', function() {
      blockService._incompleteChains = [ [block2, block1] ];
      blockService._updateOutOfOrderStateChainInfo(block6);
      expect(blockService._incompleteChains).to.deep.equal([ [ block2, block1 ], [ block6 ] ]);
    });

    it('should join multiple different chains', function() {
      blockService._incompleteChains = [ [block2, block1], [block6], [block6_1], [block4] ];
      blockService._updateOutOfOrderStateChainInfo(block5);
      expect(blockService._incompleteChains).to.deep.equal([
        [ block2, block1 ],
        [ block6, block5, block4 ],
        [ block6_1, block5, block4 ]
      ]);
    });
  });

  describe('#_updateReorgStateChainInfo', function() {
    it('should update chain tips for reorg situation', function() {
      blockService._chainTips = [];
      blockService._updateReorgStateChainInfo({ hash: 'aa' });
      expect(blockService._chainTips).to.deep.equal([ 'aa' ]);
    });
  });

  describe('#_updateNormalStateChainInfo', function() {

    it('should update chain tips when there is no incomplete chains', function() {
      var block2 = { hash: 'bb', header: { prevHash: new Buffer('aa', 'hex') } };
      blockService._incompleteChains = [];
      blockService._chainTips = [ 'aa' ];
      blockService._updateNormalStateChainInfo(block2, 'aa');
      expect(blockService._chainTips).to.deep.equal([ 'bb' ]);
      expect(blockService._incompleteChains).to.deep.equal([]);
    });

    it('should update chain tips when there is an incomplete chain', function() {
      var block2 = { hash: 'bb', header: { prevHash: new Buffer('aa', 'hex') } };
      var block3 = { hash: 'cc', header: { prevHash: new Buffer('bb', 'hex') } };
      var block4 = { hash: 'dd', header: { prevHash: new Buffer('cc', 'hex') } };
      blockService._incompleteChains = [ [ block4, block3 ] ];
      blockService._chainTips = [ 'aa' ];
      blockService._updateNormalStateChainInfo(block2, 'aa');
      expect(blockService._chainTips).to.deep.equal([ 'dd' ]);
      expect(blockService._incompleteChains).to.deep.equal([]);
    });

    it('should update chain tip when there are mulitipla chain tips', function() {
      var block4 = { hash: 'dd', header: { prevHash: new Buffer('cc', 'hex') } };
      var block5 = { hash: 'ee', header: { prevHash: new Buffer('dd', 'hex') } };
      var block6_1 = { hash: '11', header: { prevHash: new Buffer('ee', 'hex') } };
      var block6 = { hash: 'ff', header: { prevHash: new Buffer('ee', 'hex') } };
      blockService._incompleteChains = [ [ block6, block5 ], [ block6_1, block5 ] ];
      blockService._chainTips = [ 'cc' ];
      blockService._updateNormalStateChainInfo(block4, 'cc');
      expect(blockService._chainTips).to.deep.equal([ '11', 'ff' ]);
      expect(blockService._incompleteChains).to.deep.equal([]);
    });
  });

});

