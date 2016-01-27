'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var bitcorenode = require('../../../');
var bitcore = require('bitcore-lib');
var Address = bitcore.Address;
var Script = bitcore.Script;
var AddressService = bitcorenode.services.Address;
var Networks = bitcore.Networks;
var encoding = require('../../../lib/services/address/encoding');

var mockdb = {
};

var mocknode = {
  network: Networks.testnet,
  datadir: 'testdir',
  db: mockdb,
  services: {
    bitcoind: {
      on: sinon.stub()
    }
  }
};

describe('Address Service Encoding', function() {

  describe('#encodeSpentIndexSyncKey', function() {
    it('will encode to 36 bytes (string)', function() {
      var txidBuffer = new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', 'hex');
      var key = encoding.encodeSpentIndexSyncKey(txidBuffer, 12);
      key.length.should.equal(36);
    });
    it('will be able to decode encoded value', function() {
      var txid = '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7';
      var txidBuffer = new Buffer(txid, 'hex');
      var key = encoding.encodeSpentIndexSyncKey(txidBuffer, 12);
      var keyBuffer = new Buffer(key, 'binary');
      keyBuffer.slice(0, 32).toString('hex').should.equal(txid);
      var outputIndex = keyBuffer.readUInt32BE(32);
      outputIndex.should.equal(12);
    });
  });

  describe('#_encodeInputKeyMap/#_decodeInputKeyMap roundtrip', function() {
    var encoded;
    var outputTxIdBuffer = new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', 'hex');
    it('encode key', function() {
      encoded = encoding.encodeInputKeyMap(outputTxIdBuffer, 13);
    });
    it('decode key', function() {
      var key = encoding.decodeInputKeyMap(encoded);
      key.outputTxId.toString('hex').should.equal(outputTxIdBuffer.toString('hex'));
      key.outputIndex.should.equal(13);
    });
  });

  describe('#_encodeInputValueMap/#_decodeInputValueMap roundtrip', function() {
    var encoded;
    var inputTxIdBuffer = new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', 'hex');
    it('encode key', function() {
      encoded = encoding.encodeInputValueMap(inputTxIdBuffer, 7);
    });
    it('decode key', function() {
      var key = encoding.decodeInputValueMap(encoded);
      key.inputTxId.toString('hex').should.equal(inputTxIdBuffer.toString('hex'));
      key.inputIndex.should.equal(7);
    });
  });


  describe('#extractAddressInfoFromScript', function() {
    it('pay-to-publickey', function() {
      var pubkey = new bitcore.PublicKey('022df8750480ad5b26950b25c7ba79d3e37d75f640f8e5d9bcd5b150a0f85014da');
      var script = Script.buildPublicKeyOut(pubkey);
      var info = encoding.extractAddressInfoFromScript(script, Networks.livenet);
      info.addressType.should.equal(Address.PayToPublicKeyHash);
      info.hashBuffer.toString('hex').should.equal('9674af7395592ec5d91573aa8d6557de55f60147');
    });
    it('pay-to-publickeyhash', function() {
      var script = Script('OP_DUP OP_HASH160 20 0x0000000000000000000000000000000000000000 OP_EQUALVERIFY OP_CHECKSIG');
      var info = encoding.extractAddressInfoFromScript(script, Networks.livenet);
      info.addressType.should.equal(Address.PayToPublicKeyHash);
      info.hashBuffer.toString('hex').should.equal('0000000000000000000000000000000000000000');
    });
    it('pay-to-scripthash', function() {
      var script = Script('OP_HASH160 20 0x0000000000000000000000000000000000000000 OP_EQUAL');
      var info = encoding.extractAddressInfoFromScript(script, Networks.livenet);
      info.addressType.should.equal(Address.PayToScriptHash);
      info.hashBuffer.toString('hex').should.equal('0000000000000000000000000000000000000000');
    });
    it('non-address script type', function() {
      var buf = new Buffer(40);
      buf.fill(0);
      var script = Script('OP_RETURN 40 0x' + buf.toString('hex'));
      var info = encoding.extractAddressInfoFromScript(script, Networks.livenet);
      info.should.equal(false);
    });
  });

});
