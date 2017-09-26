'use strict';

var should = require('chai').should();

var Encoding = require('../../../lib/services/header/encoding');

describe('Header service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');

  var hashPrefix = new Buffer('00', 'hex');
  var heightPrefix = new Buffer('01', 'hex');
  var encoding = new Encoding(servicePrefix);
  var hash = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var hashBuf = new Buffer(hash, 'hex');
  var header = {
    hash: hash,
    prevHash: '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03ade',
    version: 0x2000012,
    merkleRoot: '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03adf',
    timestamp: 1E9,
    bits: 400000,
    nonce: 123456,
    height: 123,
    chainwork: '0000000000000000000000000000000000000000000000000000000200020002',
    nextHash: '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03ade'
  };
  var versionBuf = new Buffer(4);
  var prevHashBuf = new Buffer(header.prevHash, 'hex');
  var nextHashBuf = new Buffer(header.nextHash, 'hex');
  var merkleRootBuf = new Buffer(header.merkleRoot, 'hex');
  var tsBuf = new Buffer(4);
  var bitsBuf = new Buffer(4);
  var nonceBuf = new Buffer(4);
  var heightBuf = new Buffer(4);
  var chainBuf = new Buffer('0000000000000000000000000000000000000000000000000000000200020002', 'hex');
  heightBuf.writeUInt32BE(header.height);

  it('should encode header hash key' , function() {
    encoding.encodeHeaderHashKey(hash).should.deep.equal(Buffer.concat([servicePrefix, hashPrefix, hashBuf]));
  });

  it('should decode header hash key', function() {
    encoding.decodeHeaderHashKey(Buffer.concat([servicePrefix, hashPrefix, hashBuf]))
    .should.deep.equal(hash);
  });

  it('should encode header height key' , function() {
    encoding.encodeHeaderHeightKey(header.height).should.deep.equal(Buffer.concat([servicePrefix, heightPrefix, heightBuf]));
  });

  it('should decode header height key', function() {
    encoding.decodeHeaderHeightKey(Buffer.concat([servicePrefix, heightPrefix, heightBuf]))
    .should.deep.equal(header.height);
  });
  it('should encode header value', function() {
    var prevHashBuf = new Buffer(header.prevHash, 'hex');
    versionBuf.writeInt32BE(header.version); // signed
    tsBuf.writeUInt32BE(header.timestamp);
    bitsBuf.writeUInt32BE(header.bits);
    nonceBuf.writeUInt32BE(header.nonce);
    heightBuf.writeUInt32BE(header.height);
    encoding.encodeHeaderValue(header).should.deep.equal(Buffer.concat([
      hashBuf,
      versionBuf,
      prevHashBuf,
      merkleRootBuf,
      tsBuf,
      bitsBuf,
      nonceBuf,
      heightBuf,
      chainBuf,
      nextHashBuf
    ]));
  });

  it('should decode header value', function() {
    encoding.decodeHeaderValue(Buffer.concat([
      hashBuf,
      versionBuf,
      prevHashBuf,
      merkleRootBuf,
      tsBuf,
      bitsBuf,
      nonceBuf,
      heightBuf,
      chainBuf,
      nextHashBuf
    ])).should.deep.equal(header);
  });
});

