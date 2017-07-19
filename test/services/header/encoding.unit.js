'use strict';

var should = require('chai').should();

var Encoding = require('../../../lib/services/header/encoding');

describe('Header service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var encoding = new Encoding(servicePrefix);
  var hash = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var header = {
    prevHash: '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03ade',
    version: 0x2000012,
    merkleRoot: '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03adf',
    timestamp: 1E9,
    bits: 400000,
    nonce: 123456,
    height: 123
  };
  var versionBuf = new Buffer(4);
  var prevHash = new Buffer(header.prevHash, 'hex');
  var merkleRoot = new Buffer(header.merkleRoot, 'hex');
  var tsBuf = new Buffer(4);
  var bitsBuf = new Buffer(4);
  var nonceBuf = new Buffer(4);
  var heightBuf = new Buffer(4);

  it('should encode header key' , function() {
    var hashBuf = new Buffer(hash, 'hex');
    encoding.encodeHeaderKey(hash).should.deep.equal(Buffer.concat([servicePrefix, hashBuf]));
  });

  it('should decode header key', function() {
    var hashBuf = new Buffer(hash, 'hex');
    encoding.decodeHeaderKey(Buffer.concat([servicePrefix, hashBuf]))
    .should.equal(hash);
  });

  it('should encode header value', function() {
    versionBuf.writeInt32BE(header.version); // signed
    tsBuf.writeUInt32BE(header.timestamp);
    bitsBuf.writeUInt32BE(header.bits);
    nonceBuf.writeUInt32BE(header.nonce);
    heightBuf.writeUInt32BE(header.height);
    encoding.encodeHeaderValue(header).should.deep.equal(Buffer.concat([
      versionBuf,
      prevHash,
      merkleRoot,
      tsBuf,
      bitsBuf,
      nonceBuf,
      heightBuf
    ]));

  });

  it('should decode header value', function() {
    encoding.decodeHeaderValue(Buffer.concat([
      versionBuf,
      prevHash,
      merkleRoot,
      tsBuf,
      bitsBuf,
      nonceBuf,
      heightBuf
    ])).should.deep.equal(header);
  });
});

