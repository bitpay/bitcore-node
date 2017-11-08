'use strict';

var should = require('chai').should();
var tx = require('bcoin').tx;

var Encoding = require('../../../lib/services/mempool/encoding');

describe('Block service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var txPrefix = new Buffer('00', 'hex');
  var addressPrefix = new Buffer('01', 'hex');

  var encoding = new Encoding(servicePrefix);
  var hash = '25e28f9fb0ada5353b7d98d85af5524b2f8df5b0b0e2d188f05968bceca603eb';
  var txString = '0100000004de9b4bb17f627096a9ee0b4528e4eae17df5b5c69edc29704c2e84a7371db29f010000006b483045022100f5b1a0d33b7be291c3953c25f8ae39d98601aa7099a8674daf638a08b86c7173022006ce372da5ad088a1cc6e5c49c2760a1b6f085eb1b51b502211b6bc9508661f9012102ec5e3731e54475dd2902326f43602a03ae3d62753324139163f81f20e787514cffffffff7a1d4e5fc2b8177ec738cd723a16cf2bf493791e55573445fc0df630fe5e2d64010000006b483045022100cf97f6cb8f126703e9768545dfb20ffb10ba78ae3d101aa46775f5a239b075fc02203150c4a89a11eaf5e404f4f96b62efa4455e9525765a025525c7105a7e47b6db012102c01e11b1d331f999bbdb83e8831de503cd52a01e3834a95ccafd615c67703d77ffffffff9e52447116415ca0d0567418a1a4ef8f27be3ff5a96bf87c922f3723d7db5d7c000000006b483045022100f6c117e536701be41a6b0b544d7c3b1091301e4e64a6265b6eb167b15d16959d022076916de4b115e700964194ce36a24cb9105f86482f4abbc63110c3f537cd5770012102ddf84cc7bee2d6a82ac09628a8ad4a26cd449fc528b81e7e6cc615707b8169dfffffffff5815d9750eb3572e30d6fd9df7afb4dbd76e042f3aa4988ac763b3fdf8397f80010000006a473044022028f4402b736066d93d2a32b28ccd3b7a21d84bb58fcd07fe392a611db94cdec5022018902ee0bf2c3c840c1b81ead4e6c87c88c48b2005bf5eea796464e561a620a8012102b6cdd1a6cd129ef796faeedb0b840fcd0ca00c57e16e38e46ee7028d59812ae7ffffffff0220a10700000000001976a914c342bcd1a7784d9842f7386b8b3b8a3d4171a06e88ac59611100000000001976a91449f8c749a9960dc29b5cbe7d2397cea7d26611bb88ac00000000';
  var address = '1234567';
  var now = Math.floor(Date.now() / 1000);
  var nowBuf = new Buffer(4);
  nowBuf.writeUInt32BE(now);

  describe('Mempool', function() {

    it('should encode mempool transaction key', function() {
      encoding.encodeMempoolTransactionKey(hash).should.deep.equal(Buffer.concat([ servicePrefix, txPrefix, new Buffer(hash, 'hex') ]));
    });

    it('should decode mempool transaction key', function() {
      encoding.decodeMempoolTransactionKey(Buffer.concat([ servicePrefix, txPrefix, new Buffer(hash, 'hex') ])).should.deep.equal(hash);
    });

    it('should encode mempool transaction value', function() {
      var mytx = tx.fromRaw(txString, 'hex');
      mytx.__inputValues = [1012955, 447698, 446664, 391348];
      encoding.encodeMempoolTransactionValue(mytx).should.deep.equal(new Buffer(txString, 'hex'));
    });

    it('should decode mempool transaction value', function() {
      var mytx = encoding.decodeMempoolTransactionValue(new Buffer(txString, 'hex'));
      mytx.should.deep.equal(tx.fromRaw(txString, 'hex'));
    });

    it('should encode mempool address key', function() {

      encoding.encodeMempoolAddressKey(address, hash, 0, 1)
        .should.deep.equal(Buffer.concat([
          servicePrefix,
          addressPrefix,
          new Buffer('07', 'hex'),
          new Buffer(address),
          new Buffer(hash, 'hex'),
          new Buffer('00000000', 'hex'),
          new Buffer('01', 'hex')
        ]));
    });

    it('should decode mempool address key', function() {
      encoding.decodeMempoolAddressKey(Buffer.concat([
        servicePrefix,
        addressPrefix,
        new Buffer('07', 'hex'),
        new Buffer(address),
        new Buffer(hash, 'hex'),
        new Buffer('00000000', 'hex'),
        new Buffer('01', 'hex') ])).should.deep.equal({
          address: address,
          txid: hash,
          index: 0,
          input: 1,
        });
    });

  });

});


