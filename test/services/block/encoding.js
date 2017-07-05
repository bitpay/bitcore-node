'use strict';

var should = require('chai').should();
var Block = require('bitcore-lib').Block;

var Encoding = require('../../../lib/services/block/encoding');

describe('Block service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');

  var blockPrefix = new Buffer('00', 'hex');
  var hashPrefix = new Buffer('01', 'hex');
  var heightPrefix = new Buffer('02', 'hex');

  var encoding = new Encoding(servicePrefix);
  var hash = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var height = 1;
  var header = { hash: hash, height: height };
  var block = new Block(new Buffer('0100000095194b8567fe2e8bbda931afd01a7acd399b9325cb54683e64129bcd00000000660802c98f18fd34fd16d61c63cf447568370124ac5f3be626c2e1c3c9f0052d19a76949ffff001d33f3c25d0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d014dffffffff0100f2052a01000000434104e70a02f5af48a1989bf630d92523c9d14c45c75f7d1b998e962bff6ff9995fc5bdb44f1793b37495d80324acba7c8f537caaf8432b8d47987313060cc82d8a93ac00000000', 'hex'));

  describe('Block', function() {

    it('should encode block key' , function() {
      encoding.encodeBlockKey(hash).should.deep.equal(Buffer.concat([
        servicePrefix,
        blockPrefix,
        new Buffer(hash, 'hex')
      ]));
    });

    it('should decode block key' , function() {
      var buf = Buffer.concat([
        servicePrefix,
        blockPrefix,
        new Buffer(hash, 'hex')
      ]);

      var actual = encoding.decodeBlockKey(buf);
      actual.should.deep.equal(hash);
    });

    it('should encode block value', function() {
      encoding.encodeBlockValue(block).should.deep.equal(
        block.toBuffer());
    });

    it('shound decode block value', function() {
      var ret = encoding.decodeBlockValue(block.toBuffer());
      ret.should.deep.equal(ret);
    });

  });

  describe('Hash', function() {
    it('should encode hash key', function() {
      encoding.encodeHashKey(hash).should.deep.equal(Buffer.concat([
        servicePrefix,
        hashPrefix,
        new Buffer(hash, 'hex')
      ]));
    });

    it('should decode hash key', function() {
      encoding.decodeHashKey(Buffer.concat([
        servicePrefix,
        hashPrefix,
        new Buffer(hash, 'hex')
      ])).should.deep.equal(hash);
    });

    it('should encode header value', function() {
      encoding.encodeHeaderValue(header).should.deep.equal(new Buffer(JSON.stringify(header), 'utf8'));
    });

    it('should decode hash value', function() {
      encoding.decodeHeaderValue(new Buffer(JSON.stringify(header), 'utf8')).should.deep.equal(header);
    });
  });

  describe('Height', function() {
    it('should encode height key', function() {
      encoding.encodeHeightKey(height).should.deep.equal(Buffer.concat([
        servicePrefix,
        heightPrefix,
        new Buffer('00000001', 'hex')
      ]));
    });

    it('should decode height key', function() {
      encoding.decodeHeightKey(Buffer.concat([
        servicePrefix,
        heightPrefix,
        new Buffer('00000001', 'hex')
      ])).should.deep.equal(height);
    });
  });

});

