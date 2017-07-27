'use strict';

var should = require('chai').should();
var bcoin = require('bcoin');
var Tx = bcoin.tx;
var Block = bcoin.block;
var sinon = require('sinon');
var TxService = require('../../../lib/services/transaction');
var Encoding  = require('../../../lib/services/transaction/encoding');

describe('Transaction Service', function() {
  var block = Block.fromRaw('010000006a39821735ec18a366d95b391a7ff10dee181a198f1789b0550e0d00000000002b0c80fa52b669022c344c3e09e6bb9698ab90707bb4bb412af3fbf31cfd2163a601514c5a0c011c572aef0f0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c022003ffffffff0100f2052a01000000434104c5b694d72e601091fd733c6b18b94795c13e2db6b1474747e7be914b407854cad37cee3058f85373b9f9dbb0014e541c45851d5f85e83a1fd7c45e54423718f3ac00000000', 'hex');
  var tx = Tx.fromRaw( '0100000004de9b4bb17f627096a9ee0b4528e4eae17df5b5c69edc29704c2e84a7371db29f010000006b483045022100f5b1a0d33b7be291c3953c25f8ae39d98601aa7099a8674daf638a08b86c7173022006ce372da5ad088a1cc6e5c49c2760a1b6f085eb1b51b502211b6bc9508661f9012102ec5e3731e54475dd2902326f43602a03ae3d62753324139163f81f20e787514cffffffff7a1d4e5fc2b8177ec738cd723a16cf2bf493791e55573445fc0df630fe5e2d64010000006b483045022100cf97f6cb8f126703e9768545dfb20ffb10ba78ae3d101aa46775f5a239b075fc02203150c4a89a11eaf5e404f4f96b62efa4455e9525765a025525c7105a7e47b6db012102c01e11b1d331f999bbdb83e8831de503cd52a01e3834a95ccafd615c67703d77ffffffff9e52447116415ca0d0567418a1a4ef8f27be3ff5a96bf87c922f3723d7db5d7c000000006b483045022100f6c117e536701be41a6b0b544d7c3b1091301e4e64a6265b6eb167b15d16959d022076916de4b115e700964194ce36a24cb9105f86482f4abbc63110c3f537cd5770012102ddf84cc7bee2d6a82ac09628a8ad4a26cd449fc528b81e7e6cc615707b8169dfffffffff5815d9750eb3572e30d6fd9df7afb4dbd76e042f3aa4988ac763b3fdf8397f80010000006a473044022028f4402b736066d93d2a32b28ccd3b7a21d84bb58fcd07fe392a611db94cdec5022018902ee0bf2c3c840c1b81ead4e6c87c88c48b2005bf5eea796464e561a620a8012102b6cdd1a6cd129ef796faeedb0b840fcd0ca00c57e16e38e46ee7028d59812ae7ffffffff0220a10700000000001976a914c342bcd1a7784d9842f7386b8b3b8a3d4171a06e88ac59611100000000001976a91449f8c749a9960dc29b5cbe7d2397cea7d26611bb88ac00000000', 'hex');
  var txService;
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    txService = new TxService({
      node: {
        getNetworkName: function() { return 'regtest'; },
        services: []
      }
    });
    txService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#start', function() {
    it('should get the prefix and the service tip', function(done) {
      var startSubs = sandbox.stub(txService, '_startSubscriptions');
      var getPrefix = sandbox.stub().callsArgWith(1, null, new Buffer('ffee', 'hex'));
      var getServiceTip = sandbox.stub().callsArgWith(1, null, { height: 1, hash: 'aa' });
      txService._db = { getPrefix: getPrefix, getServiceTip: getServiceTip };
      txService.start(function() {
        startSubs.calledOnce.should.be.true;
        getServiceTip.calledOnce.should.be.true;
        getPrefix.calledOnce.should.be.true;
        txService._encoding.should.be.instanceOf(Encoding);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('should stop the service', function(done) {
      txService.stop(done);
    });
  });

  describe('#sendTransaction', function() {
    it('should send a raw transaction', function(done) {
      var sendTransaction = sandbox.stub().callsArg(0);
      txService._p2p = { sendTransaction: sendTransaction };
      txService.sendTransaction(function(err) {
        if (err) {
          return done(err);
        }
        done();
      });
    });
  });

  describe('#_cacheOutputValues', function() {
    it('should cache output values', function() {
      txService._cacheOutputValues(tx);
      txService._inputValuesCache.get('25e28f9fb0ada5353b7d98d85af5524b2f8df5b0b0e2d188f05968bceca603eb').should.deep.equal([ 50000000000000, 113903300000000 ]);
    });
  });

  describe('#_getBlockTimestamp', function() {
    it('should get the block\'s timestamp', function() {
      var getTimestamp = sandbox.stub().returns(1);
      txService._timestamp = { getTimestampSync: getTimestamp };
      var timestamp = txService._getBlockTimestamp('aa');
      timestamp.should.equal(1);
    });
  });

  describe('#onBlock', function() {
    it('should process new blocks that come in from the block service', function(done) {
      var getTimestamp = sandbox.stub().returns(1);
      txService._timestamp = { getTimestampSync: getTimestamp };
      var batch = sandbox.stub().callsArgWith(1, null);
      txService._db = { batch: batch };
      txService.onBlock(block, function(err, ops) {
        txService._encoding.decodeTransactionKey(ops[0].key).should
          .equal('6321fd1cf3fbf32a41bbb47b7090ab9896bbe6093e4c342c0269b652fa800c2b');
        txService._encoding.decodeTransactionValue(ops[0].value).should
          .be.instanceOf(Tx);
        done();
      });
    });
  });

  describe('#_onReorg', function() {
    it('should perform a reorg', function() {
      var commonAncestorHeader = block.toHeaders().toJSON();
      var oldList = [];
      txService._tip = { height: 80000, hash: 'aa' };
      var batch = sandbox.stub().callsArgWith(1, null);
      txService._db = { batch: batch };
      txService._onReorg(commonAncestorHeader, oldList);
      batch.should.be.calledOnce;
      batch.args[0][0][0].key.toString('hex').should.deep.equal('ffff7469702d756e646566696e6564');
      batch.args[0][0][0].value.toString('hex').should.deep.equal('0000000000000000008ba8d6beb01577730fae52517988564322026e5e2d90a3ee5d3cfb');
    });
  });

  describe('#_startSubscriptions', function() {
    it('should start subscriptions', function() {

      var on = sandbox.stub();
      var subscribe = sandbox.stub();
      txService._bus = { on: on, subscribe: subscribe };
      txService._startSubscriptions();
      on.should.be.calledOnce;
      subscribe.should.be.calledOnce;
    });
  });

});
