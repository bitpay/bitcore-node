'use strict';

var should = require('chai').should();
var Block = require('bcoin').block;

var Encoding = require('../../../lib/services/block/encoding');

describe('Block service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');

  var encoding = new Encoding(servicePrefix);
  var hash = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var height = 1;
  var block = Block.fromRaw('0100000095194b8567fe2e8bbda931afd01a7acd399b9325cb54683e64129bcd00000000660802c98f18fd34fd16d61c63cf447568370124ac5f3be626c2e1c3c9f0052d19a76949ffff001d33f3c25d0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d014dffffffff0100f2052a01000000434104e70a02f5af48a1989bf630d92523c9d14c45c75f7d1b998e962bff6ff9995fc5bdb44f1793b37495d80324acba7c8f537caaf8432b8d47987313060cc82d8a93ac00000000', 'hex');

  describe('Block', function() {

    it('should encode block key' , function() {
      encoding.encodeBlockKey(hash).should.deep.equal(Buffer.concat([
        servicePrefix,
        new Buffer(hash, 'hex')
      ]));
    });

    it('should decode block key' , function() {
      var buf = Buffer.concat([
        servicePrefix,
        new Buffer(hash, 'hex')
      ]);

      var actual = encoding.decodeBlockKey(buf);
      actual.should.deep.equal(hash);
    });

    it('should encode block value', function() {
      encoding.encodeBlockValue(block).should.deep.equal(
        block.toRaw());
    });

    it('shound decode block value', function() {
      var ret = encoding.decodeBlockValue(block.toRaw());
      ret.should.deep.equal(ret);
    });

  });

});

