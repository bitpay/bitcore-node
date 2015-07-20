'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var bitcore = require('bitcore');
var BN = bitcore.crypto.BN;
var BufferWriter = bitcore.encoding.BufferWriter;
var BufferReader = bitcore.encoding.BufferReader;
var bitcoindjs = require('../');
var Block = bitcoindjs.Block;
var chainData = require('./data/pow-chain.json');

describe('Bitcoin Block', function() {

  describe('@constructor', function() {
    it('set bits and nonce', function() {
      var block = new Block(chainData[1]);
      should.exist(block.bits);
      block.bits.should.equal(chainData[1].bits);
      should.exist(block.nonce);
      block.nonce.should.equal(chainData[1].nonce);
    });
  });

  describe('#fromBuffer', function() {
    var buffer = new Buffer('010000004404c1ff5f300e5ed830b45ec9f68fbe9a0c51c4b4eaa4ce09a03ac4ddde01750000000000000000000000000000000000000000000000000000000000000000b134de547fcc071f4a020000abcdef', 'hex');

    it('deserializes correctly', function() {
      var block = Block.fromBuffer(buffer);
      block.version.should.equal(1);
      block.prevHash.should.equal('7501deddc43aa009cea4eab4c4510c9abe8ff6c95eb430d85e0e305fffc10444');
      block.merkleRoot.should.equal(new Buffer(Array(32)).toString('hex'));
      block.timestamp.should.be.instanceof(Date);
      block.timestamp.toISOString().should.equal('2015-02-13T17:30:25.000Z');
      block.bits.should.equal(520604799);
      block.nonce.should.equal(586);
      block.data.should.deep.equal(new Buffer('abcdef', 'hex'));
    });
    it('roundtrip serialization', function() {
      var actual = Block.fromBuffer(buffer).toBuffer();
      actual.should.deep.equal(buffer);
    });
    it('set null prevHash if null hash buffer', function() {
      var blockBuffer = new Buffer('0100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d4d5fd834b0100007fcc071f4a020000abcdef', 'hex');
      var block = Block.fromBuffer(blockBuffer);
      block.hasOwnProperty('prevHash').should.equal(true);
      should.equal(block.prevHash, null);
    });
  });

  describe('#headerToBufferWriter', function() {
    it('serializes correctly', function() {
      var block = new Block(chainData[1]);
      var bw = new BufferWriter();
      block.headerToBufferWriter(bw);
      bw.bufs[0].toString('hex').should.equal('01000000'); // version
      BufferReader(bw.bufs[1]).readReverse().toString('hex').should.equal(chainData[1].prevHash); // prevhash
      Number(bw.bufs[2].toString('hex')).should.equal(0); // merkle root
      should.exist(bw.bufs[3]); // time
      bw.bufs[3].length.should.equal(4);
      should.exist(bw.bufs[4]); // bits
      bw.bufs[4].length.should.equal(4);
      should.exist(bw.bufs[5]); // nonce
      bw.bufs[5].length.should.equal(4);
    });
  });

  describe('Bitcoin Block', function() {
    it('should load and serialize the Bitcoin testnet genesis block correctly', function() {
      var blockBuffer = new Buffer('0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff001d1aa4ae180101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000', 'hex');
      var block = Block.fromBuffer(blockBuffer);
      block.hash.should.equal('000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943');
    });
    it('should load and serialize Bitcoin testnet #1 block correctly', function() {
      var blockBuffer = new Buffer('0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000', 'hex');
      var block = Block.fromBuffer(blockBuffer);
      block.hash.should.equal('00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206');
      block.toBuffer().should.deep.equal(blockBuffer);
    });
  });

});
