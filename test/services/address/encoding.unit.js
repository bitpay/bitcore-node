'use strict';

var bitcore = require('bitcore-lib');
var should = require('chai').should();
var Encoding = require('../../../lib/services/address/encoding');

describe('Address service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var encoding = new Encoding(servicePrefix);
  var txid = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var address = '1EZBqbJSHFKSkVPNKzc5v26HA6nAHiTXq6';
  var height = 1;
  var addressSizeBuf = new Buffer(1);
  var prefix0 = new Buffer('00', 'hex');
  var prefix1 = new Buffer('01', 'hex');
  var ts = Math.floor(new Date('2017-02-28').getTime() / 1000);
  var tsBuf = new Buffer(4);
  tsBuf.writeUInt32BE(ts);
  addressSizeBuf.writeUInt8(address.length);
  var addressIndexKeyBuf = Buffer.concat([
    servicePrefix,
    prefix0,
    addressSizeBuf,
    new Buffer(address),
    new Buffer('00000001', 'hex'),
    new Buffer(txid, 'hex'),
    new Buffer('00000000', 'hex'),
    new Buffer('00', 'hex'),
    tsBuf
  ]);
  var outputIndex = 5;
  var utxoKeyBuf = Buffer.concat([
    servicePrefix,
    prefix1,
    addressSizeBuf,
    new Buffer(address),
    new Buffer(txid, 'hex'),
    new Buffer('00000005', 'hex')]);
  var txHex = '0100000001cc3ffe0638792c8b39328bb490caaefe2cf418f2ce0144956e0c22515f29724d010000006a473044022030ce9fa68d1a32abf0cd4adecf90fb998375b64fe887c6987278452b068ae74c022036a7d00d1c8af19e298e04f14294c807ebda51a20389ad751b4ff3c032cf8990012103acfcb348abb526526a9f63214639d79183871311c05b2eebc727adfdd016514fffffffff02f6ae7d04000000001976a9144455183e407ee4d3423858c8a3275918aedcd18e88aca99b9b08010000001976a9140beceae2c29bfde08d2b6d80b33067451c5887be88ac00000000';
  var tx = new bitcore.Transaction(txHex);
  var sats = tx.outputs[0].satoshis;
  var satsBuf = new Buffer(8);
  satsBuf.writeDoubleBE(sats);
  var utxoValueBuf = Buffer.concat([new Buffer('00000001', 'hex'), satsBuf, tsBuf, tx.outputs[0]._scriptBuffer]);

  it('should encode address key' , function() {
    encoding.encodeAddressIndexKey(address, height, txid, 0, 0, ts).should.deep.equal(addressIndexKeyBuf);
  });

  it('should decode address key', function() {
    var addressIndexKey = encoding.decodeAddressIndexKey(addressIndexKeyBuf);
    addressIndexKey.address.should.equal(address);
    addressIndexKey.txid.should.equal(txid);
    addressIndexKey.height.should.equal(height);
  });

  it('should encode utxo key', function() {
    encoding.encodeUtxoIndexKey(address, txid, outputIndex).should.deep.equal(utxoKeyBuf);
  });

  it('should decode utxo key', function() {
    var utxoKey = encoding.decodeUtxoIndexKey(utxoKeyBuf);
    utxoKey.address.should.equal(address);
    utxoKey.txid.should.equal(txid);
    utxoKey.outputIndex.should.equal(outputIndex);
  });
  it('should encode utxo value', function() {
    encoding.encodeUtxoIndexValue(
      height,
      tx.outputs[0].satoshis,
      ts,
      tx.outputs[0]._scriptBuffer).should.deep.equal(utxoValueBuf);
  });

  it('should decode utxo value', function() {
    var utxoValue = encoding.decodeUtxoIndexValue(utxoValueBuf);
    utxoValue.height.should.equal(height);
    utxoValue.satoshis.should.equal(sats);
    utxoValue.script.should.deep.equal(tx.outputs[0]._scriptBuffer);
    utxoValue.timestamp.should.equal(ts);
  });
});

