'use strict';

var should = require('chai').should();

var Encoding = require('../../../lib/services/block/encoding');

describe('Wallet-Api service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var encoding = new Encoding(servicePrefix);
  var block = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var height = 1;

  it('should encode block hash key' , function() {
    encoding.encodeBlockHashKey(block).should.deep.equal(Buffer.concat([
      servicePrefix,
      new Buffer('00', 'hex'),
      new Buffer(block, 'hex')
    ]));
  });

  it('should decode block hash key' , function() {
    encoding.decodeBlockHashKey(Buffer.concat([
      servicePrefix,
      new Buffer('00', 'hex'),
      new Buffer(block, 'hex')
    ])).should.deep.equal(block);
  });

  it('should encode block hash value', function() {
    encoding.encodeBlockHashValue(block).should.deep.equal(
      new Buffer(block, 'hex'));
  });

  it('shound decode block hash value', function() {
   encoding.decodeBlockHashValue(new Buffer(block, 'hex')).should.deep.equal(block);
  });

  it('should encode block height key', function() {
    encoding.encodeBlockHeightKey(height).should.deep.equal(Buffer.concat([
      servicePrefix,
      new Buffer('01', 'hex'),
      new Buffer('00000001', 'hex')
    ]));
  });

  it('should decode block height key', function() {
    encoding.decodeBlockHeightKey(Buffer.concat([
      servicePrefix,
      new Buffer('01', 'hex'),
      new Buffer('00000001', 'hex')
    ])).should.deep.equal(height);
  });

  it('should encode block height value', function() {
    encoding.encodeBlockHeightValue(height).should.deep.equal(new Buffer('00000001', 'hex'));
  });

  it('should decode block height value', function() {
    encoding.decodeBlockHeightValue(new Buffer('00000001', 'hex')).should.deep.equal(height);
  });
});

