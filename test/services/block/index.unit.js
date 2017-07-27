'use strict';

var expect = require('chai').expect;
var BlockService = require('../../../lib/services/block');
var sinon = require('sinon');
var Block = require('bcoin').block;
var Encoding  = require('../../../lib/services/block/encoding');

describe('Block Service', function() {

  var blockService;

  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    blockService = new BlockService({
      node: {
        getNetworkName: function() { return 'regtest'; },
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
      var toJSON = { toJSON: sandbox.stub().returns({ prevBlock: 'aa' }) };
      var toHeaders = sandbox.stub().returns(toJSON);
      var block = { toHeaders: toHeaders };
      blockService._tip = { hash: 'aa' };
      var res = blockService._detectReorg(block);
      expect(res).to.be.false;
    });
  });

  describe('#_findCommonAncestor', function() {
    it('should find the common ancestor between the current chain and the new chain', function(done) {

      var block1 = Block.fromRaw('010000006a39821735ec18a366d95b391a7ff10dee181a198f1789b0550e0d00000000002b0c80fa52b669022c344c3e09e6bb9698ab90707bb4bb412af3fbf31cfd2163a601514c5a0c011c572aef0f0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c022003ffffffff0100f2052a01000000434104c5b694d72e601091fd733c6b18b94795c13e2db6b1474747e7be914b407854cad37cee3058f85373b9f9dbb0014e541c45851d5f85e83a1fd7c45e54423718f3ac00000000', 'hex');
      var block2 = Block.fromRaw('01000000fb3c5deea3902d5e6e0222435688795152ae0f737715b0bed6a88b00000000008ec0f92d33b05617cb3c3b4372aa0c2ae3aeb8aa7f34fe587db8e55b578cfac6b601514c5a0c011c98a831000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c027f01ffffffff0100f2052a0100000043410495fee5189566db550919ad2b4e5f9111dbdc2cb60b5c71ea4c0fdad59a961c42eb289e5b9fdc4cb3f3fec6dd866172720bae3e3b881fc203fcaf98bf902c53f1ac00000000', 'hex');
      blockService._tip = { hash: block2.rhash(), height: 70901 };
      var encodedData = blockService._encoding.encodeBlockValue(block2);
      var get = sandbox.stub().callsArgWith(1, null, encodedData);

      var headers = { get: sandbox.stub().returns({ prevHash: block1.rhash() }) };
      blockService._db = { get: get };
      var getOldBlocks = sandbox.stub(blockService, '_getOldBlocks').callsArgWith(1, null, []);

      blockService._findCommonAncestor('aa', headers, function(err, hash, common, oldBlocks) {
        if (err) {
          return done(err);
        }
        expect(get.calledOnce).to.be.true;
        expect(getOldBlocks.calledOnce).to.be.true;
        expect(common).to.equal(block1.rhash());
        expect(oldBlocks).to.deep.equal([]);
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

    it('should perform all the steps for onBlock handler (normal)', function() {
      var rhash = sinon.stub().returns('aa');
      var block = { rhash: rhash };
      var getAllHeaders = sandbox.stub().returns({});
      var detectReorg = sandbox.stub(blockService, '_detectReorg').returns(false);
      var processBlock = sandbox.stub(blockService, '_processBlock');
      blockService._unprocessedBlocks = [];
      blockService._header = { getAllHeaders: getAllHeaders };
      blockService._onBlock(block);
      expect(detectReorg.callCount).to.equal(1);
      expect(processBlock.callCount).to.equal(1);
    });

    it('should perform all the steps for onBlock handler (reorg)', function() {
      var rhash = sinon.stub().returns('aa');
      var block = { rhash: rhash };
      var getAllHeaders = sandbox.stub().returns({});
      var detectReorg = sandbox.stub(blockService, '_detectReorg').returns(true);
      var processBlock = sandbox.stub(blockService, '_processBlock');
      var handleReorg = sandbox.stub(blockService, '_handleReorg');
      blockService._unprocessedBlocks = [];
      blockService._header = { getAllHeaders: getAllHeaders };
      blockService._onBlock(block);
      expect(handleReorg.callCount).to.equal(1);
      expect(detectReorg.callCount).to.equal(1);
      expect(processBlock.callCount).to.equal(0);
    });

  });

  describe('#_setListeners', function() {

    it('should set listeners for headers, reorg', function() {
      var on = sandbox.stub();
      var once = sandbox.stub();
      blockService._header = { on: on, once: once };
      blockService._setListeners();
      expect(on.calledOnce).to.be.true;
      expect(once.calledOnce).to.be.true;
    });

  });

  describe('#_setTip', function() {

    it('should set the tip if given a block', function() {
      blockService._db = {};
      blockService._tip = { height: 99, hash: '00' };
      blockService._setTip({ height: 100, hash: 'aa' });
      expect(blockService._tip).to.deep.equal({ height: 100, hash: 'aa' });
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
    it('should start the sync of blocks if type set', function() {
      var sync = sandbox.stub(blockService, '_sync');
      blockService._bestHeight = 100;
      blockService._tip = { height: 99 };
      blockService._startSync();
      expect(sync.calledOnce).to.be.true;
      expect(blockService._numNeeded).to.equal(1);
    });
  });

  describe('#_sync', function() {
    it('should sync blocks', function() {
      var getAllHeaders = sandbox.stub().returns({ size: 1000, getIndex: sinon.stub() });
      var getBlocks = sandbox.stub();
      blockService._tip = { height: 99 };
      blockService._header = { getAllHeaders: getAllHeaders };
      blockService._p2p = { getBlocks: getBlocks };
      blockService._sync();
      expect(getBlocks.calledOnce).to.be.true;
    });
  });

  describe('#start', function() {

    it('should get the prefix', function(done) {
      var getPrefix = sandbox.stub().callsArgWith(1, null, blockService._encoding);
      var getServiceTip = sandbox.stub().callsArgWith(1, null, { height: 1, hash: 'aa' });
      var setListeners = sandbox.stub(blockService, '_setListeners');
      var startSub = sandbox.stub(blockService, '_startSubscriptions');
      var setTip = sandbox.stub(blockService, '_setTip');
      blockService._db = { getPrefix: getPrefix, getServiceTip: getServiceTip };
      blockService.start(function() {
        expect(blockService._encoding).to.be.an.instanceof(Encoding);
        expect(getServiceTip.calledOnce).to.be.true;
        expect(getPrefix.calledOnce).to.be.true;
        expect(startSub.calledOnce).to.be.true;
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

