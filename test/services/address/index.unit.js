'use strict';

var sinon = require('sinon');
var AddressService = require('../../../lib/services/address');
var Tx = require('bcoin').tx;
var expect = require('chai').expect;
var Encoding  = require('../../../lib/services/address/encoding');
var Readable = require('stream').Readable;
var EventEmitter = require('events').EventEmitter;
var bcoin = require('bcoin');
var lodash = require('lodash');

describe('Address Service', function() {

  var tx = Tx.fromRaw( '0100000004de9b4bb17f627096a9ee0b4528e4eae17df5b5c69edc29704c2e84a7371db29f010000006b483045022100f5b1a0d33b7be291c3953c25f8ae39d98601aa7099a8674daf638a08b86c7173022006ce372da5ad088a1cc6e5c49c2760a1b6f085eb1b51b502211b6bc9508661f9012102ec5e3731e54475dd2902326f43602a03ae3d62753324139163f81f20e787514cffffffff7a1d4e5fc2b8177ec738cd723a16cf2bf493791e55573445fc0df630fe5e2d64010000006b483045022100cf97f6cb8f126703e9768545dfb20ffb10ba78ae3d101aa46775f5a239b075fc02203150c4a89a11eaf5e404f4f96b62efa4455e9525765a025525c7105a7e47b6db012102c01e11b1d331f999bbdb83e8831de503cd52a01e3834a95ccafd615c67703d77ffffffff9e52447116415ca0d0567418a1a4ef8f27be3ff5a96bf87c922f3723d7db5d7c000000006b483045022100f6c117e536701be41a6b0b544d7c3b1091301e4e64a6265b6eb167b15d16959d022076916de4b115e700964194ce36a24cb9105f86482f4abbc63110c3f537cd5770012102ddf84cc7bee2d6a82ac09628a8ad4a26cd449fc528b81e7e6cc615707b8169dfffffffff5815d9750eb3572e30d6fd9df7afb4dbd76e042f3aa4988ac763b3fdf8397f80010000006a473044022028f4402b736066d93d2a32b28ccd3b7a21d84bb58fcd07fe392a611db94cdec5022018902ee0bf2c3c840c1b81ead4e6c87c88c48b2005bf5eea796464e561a620a8012102b6cdd1a6cd129ef796faeedb0b840fcd0ca00c57e16e38e46ee7028d59812ae7ffffffff0220a10700000000001976a914c342bcd1a7784d9842f7386b8b3b8a3d4171a06e88ac59611100000000001976a91449f8c749a9960dc29b5cbe7d2397cea7d26611bb88ac00000000', 'hex');
  var blocks = require('../../data/blocks.json');
  var addressService;
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    addressService = new AddressService({
      node: {
        services: []
      }
    });
    addressService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#start', function() {

    it('should get prefix for database', function(done) {
      var getPrefix = sandbox.stub().callsArgWith(1, null, new Buffer('ffee', 'hex'));
      addressService._db = { getPrefix: getPrefix };
      addressService.start(function() {
        expect(getPrefix.calledOnce).to.be.true;
        done();
      });
    });

  });

  describe('#stop', function() {
    it('should stop the service', function(done) {
      addressService.stop(function() {
        done();
      });
    });
  });


  describe('#getAddressHistory', function() {

    it('should get the address history (null case)', function(done) {

      sandbox.stub(addressService, '_getAddressTxidHistory').callsArgWith(2, null, null);
      sandbox.stub(addressService, '_getAddressTxHistory').callsArgWith(1, null, []);

      addressService.getAddressHistory(['a', 'b', 'c'], { from: 12, to: 14 }, function(err, res) {

        if (err) {
          return done(err);
        }

        expect(res).to.be.deep.equal({
          totalCount: 0,
          items: []
        });

        done();
      });
    });

    it('should get the sorted address history', function(done) {

      var old_getAddressTxidHistory = addressService._getAddressTxidHistory;
      addressService._getAddressTxidHistory = function(addr, options, cb) {
        options.txIdList = [
          {
            txid: "d",
            height: 10,
          },
          {
            txid: "c",
            height: 10,
          },
          {
            txid: "a",
            height: 101,
          },
          {
            txid: "b",
            height: 100,
          },
        ];
        return cb();
      };


      var old_getAddressTxHistory = addressService._getAddressTxHistory;
      addressService._getAddressTxHistory = function(options, cb) {
        return cb(null, options.txIdList);
      };

      addressService.getAddressHistory(['a', 'b', 'c'], { from: 12, to: 14 }, function(err, res) {

        if (err) {
          return done(err);
        }

        expect(res.totalCount).equal(4);
        expect(lodash.map(res.items,'txid')).to.be.deep.equal(['a','b','c','d']);

        addressService._getAddressTxidHistory = old_getAddressTxHistory;
        addressService._getAddressTxHistory = old_getAddressTxHistory;
        done();
      });
    });

    it('should remove duplicated items in history', function(done) {

      var old_getAddressTxidHistory = addressService._getAddressTxidHistory;
      addressService._getAddressTxidHistory = function(addr, options, cb) {
        options.txIdList = [
          {
            txid: "b",
            height: 10,
          },
          {
            txid: "b",
            height: 10,
          },
          {
            txid: "d",
            height: 101,
          },
          {
            txid: "c",
            height: 100,
          },
         {
            txid: "d",
            height: 101,
          },
        ];
        return cb();
      };


      var old_getAddressTxHistory = addressService._getAddressTxHistory;
      addressService._getAddressTxHistory = function(options, cb) {
        return cb(null, options.txIdList);
      };

      addressService.getAddressHistory(['a', 'b', 'c'], { from: 12, to: 14 }, function(err, res) {

        if (err) {
          return done(err);
        }

        expect(res.totalCount).equal(3);
        expect(lodash.map(res.items,'txid')).to.be.deep.equal(['d','c','b']);

        addressService._getAddressTxidHistory = old_getAddressTxHistory;
        addressService._getAddressTxHistory = old_getAddressTxHistory;
        done();
      });
    });


    describe('TxIdList cache', function() {
      var list, old_getAddressTxidHistory, old_getAddressTxHistory;

      beforeEach(function(done){
        this.clock = sinon.useFakeTimers();
        list = [];
        for(let i=1000; i>0; i--) {
          list.push({
            txid: "txid" + i,
            height: 1000  + i,

          });
        };
        old_getAddressTxidHistory = addressService._getAddressTxidHistory;
        // Note that this stub DOES NOT respect options.from/to as the real function
        addressService._getAddressTxidHistory = function(addr, options, cb) {
          options.txIdList = lodash.clone(list);
          return cb();
        };
        old_getAddressTxHistory = addressService._getAddressTxHistory;

        addressService._getAddressTxHistory = function(options, cb) {
          return cb(null, options.txIdList);
        };

        addressService.getAddressHistory(['a', 'b', 'c'], { from: 0, to: 10 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          expect(cacheUsed).equal(false);
          done();
        });
      });

      afterEach(function(done){
        this.clock.restore();

        addressService._getAddressTxidHistory = old_getAddressTxHistory;
        addressService._getAddressTxHistory = old_getAddressTxHistory;
        done();
      });


      it('should not cache the address txlist history when from =0 ', function(done) {
        addressService.getAddressHistory(['a', 'b', 'c'], { from: 0, to: 10 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          expect(cacheUsed).equal(false);
          done();
        });
      });

      it('should cache the address txlist history', function(done) {
        addressService.getAddressHistory(['a', 'b', 'c'], { from: 1, to: 10 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(cacheUsed).equal(true);
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          done();
        });
      });


      it('should retrive cached list using cachekey', function(done) {
        addressService.getAddressHistory([], { from: 1, to: 10, cacheKey: 977282097 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(cacheUsed).equal(true);
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          done();
        });
      });

   

      it('should expire cache', function(done) {
        this.clock.tick(35*1000);
        addressService.getAddressHistory(['a', 'b', 'c'], { from: 1, to: 10 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(cacheUsed).equal(false);
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          done();
        });
      });

      it('should cache using the address as key', function(done) {
        addressService.getAddressHistory(['a', 'b', 'c', 'd'], { from: 1, to: 10 }, function(err, res, cacheUsed) {
          if (err) {
            return done(err);
          }
          expect(cacheUsed).equal(false);
          expect(res.totalCount).equal(1000);
          expect(res.items,'txid').to.be.deep.equal(list);
          addressService.getAddressHistory(['a', 'b', 'c', 'd'], { from: 1, to: 10 }, function(err, res, cacheUsed) {
            if (err) {
              return done(err);
            }
            expect(cacheUsed).equal(true);
            expect(res.totalCount).equal(1000);
            expect(res.items,'txid').to.be.deep.equal(list);
            done();
          });
        });
      });


    });
  });

  describe('#_getAddressTxidHistory', function() {
    it('should get the address txid history', function(done) {

      addressService._mempool = { getTxidsByAddress: sinon.stub().callsArgWith(2, null, []) };
      var txidStream = new Readable();
      sandbox.stub(addressService, '_getTxidStream').returns(txidStream);
      var addressInfoBuf = addressService._encoding.encodeAddressIndexKey('a', 10, tx.txid(), 1, 1, 1234567);
      var options = {txIdList: []};

      addressService._getAddressTxidHistory('a', options, function(err) {

        if (err) {
          return done(err);
        }

        expect(options.txIdList).to.deep.equal([{txid: tx.txid(), height: 10}]);
        done();

      });

      txidStream.push(addressInfoBuf);
      txidStream.push(null);

    });
  });

  describe('#AddressSummary', function() {

    it('should get the address summary, incoming', function(done) {

      var _tx = tx;
      _tx.__inputValues = [ 0, 0, 0, 0 ];
      var results = { items: [_tx] };

      sandbox.stub(addressService, 'getAddressHistory').callsArgWith(2, null, results);
      addressService.getAddressSummary('1JoSiR4dBcSrGs2AZBP2gCHqCCsgzccsGb', {}, function(err, res) {
        if (err) {
          return done(err);
        }
        expect(res).to.deep.equal({ addrStr: '1JoSiR4dBcSrGs2AZBP2gCHqCCsgzccsGb',
          balance: 0.005,
          balanceSat: 500000,
          totalReceived: 0.005,
          totalReceivedSat: 500000,
          totalSent: 0,
          totalSentSat: 0,
          unconfirmedBalance: 0,
          unconfirmedBalanceSat: 0,
          unconfirmedTxApperances: 0,
          txApperances: 1,
          transactions: [ '25e28f9fb0ada5353b7d98d85af5524b2f8df5b0b0e2d188f05968bceca603eb' ]
        });
        done();
      });

    });

  });

  describe('#getAddressUnspentOutputs', function() {
    it('should get address utxos', function(done) {

      var encoding = new Encoding(new Buffer('0001', 'hex'));
      addressService._encoding = encoding;

      var address = 'a';
      var txid = tx.txid();
      var ts = Math.floor(new Date('2019-01-01').getTime() / 1000);

      var data = {
        key: encoding.encodeUtxoIndexKey(address, txid, 1),
        value: encoding.encodeUtxoIndexValue(123, 120000, ts, tx.outputs[1].script.raw)
      };

      addressService._block = { getTip: function() { return { height: 150 }; } };

      var txidStream = new EventEmitter();

      addressService._mempool = { getTxidsByAddress: sinon.stub().callsArgWith(2, null, []) };
      var createReadStream = sandbox.stub().returns(txidStream);
      addressService._db = { createReadStream: createReadStream };

      addressService.getAddressUnspentOutputs(address, {}, function(err, res) {
        if (err) {
          return done(err);
        }
        expect(res[0]).to.deep.equal({
          address: 'a',
          amount: 0.0012,
          height: 123,
          confirmations: 28,
          satoshis: 120000,
          scriptPubKey: '76a91449f8c749a9960dc29b5cbe7d2397cea7d26611bb88ac',
          ts: 1546300800,
          txid: '25e28f9fb0ada5353b7d98d85af5524b2f8df5b0b0e2d188f05968bceca603eb',
          vout: 1
        });
        done();
      });

      txidStream.emit('data', data);
      txidStream.emit('end');

    });

  });

  describe('#onReorg', function() {

    it('should reorg when there is nothing to reorg', function(done ) {

      var commonAncestorHeader = bcoin.block.fromRaw(blocks[5], 'hex').toHeaders().toJSON();
      var block = bcoin.block.fromRaw(blocks[6], 'hex');
      block.__ts = 55555;
      block.__height = 999;
      var oldBlocks = [block];

      addressService.onReorg([commonAncestorHeader, oldBlocks], function(err, ops) {

        expect(ops.length).to.equal(2);
        done();

      });

    });

  });

});
