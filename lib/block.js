'use strict';

var util = require('util');
var chainlib = require('chainlib');
var BaseBlock = chainlib.Block;
var bitcore = require('bitcore');
var BufferReader = bitcore.encoding.BufferReader;
var BN = bitcore.crypto.BN;

function Block(obj) {
  if (!obj) {
    obj = {};
  }

  BaseBlock.call(this, obj);

  this.bits = obj.bits;
  this.nonce = obj.nonce || 0;

}

util.inherits(Block, BaseBlock);

Block.prototype.validate = function(chain, callback) {
  // bitcoind does all validation
  setImmediate(callback);
};

Block.fromBuffer = function(buffer) {
  var br = new BufferReader(buffer);
  return Block.fromBufferReader(br);
};

Block.fromBufferReader = function(br) {
  var obj = {};
  obj.version = br.readUInt32LE();
  obj.prevHash = BufferReader(br.read(32)).readReverse().toString('hex');
  var nullHash = new Buffer(Array(32)).toString('hex');
  if (obj.prevHash === nullHash) {
    obj.prevHash = null;
  }
  obj.merkleRoot = BufferReader(br.read(32)).readReverse().toString('hex');
  var timestamp = br.readUInt32LE();
  obj.timestamp = new Date(timestamp * 1000);
  obj.bits = br.readUInt32LE();
  obj.nonce = br.readUInt32LE();
  obj.data = br.readAll();
  return new Block(obj);
};

Block.prototype.toObject = function() {
  return {
    version: this.version,
    prevHash: this.prevHash,
    merkleRoot: this.merkleRoot,
    timestamp: this.timestamp.toISOString(),
    bits: this.bits,
    nonce: this.nonce,
    data: this.data.toString('hex')
  };
};

Block.prototype.headerToBufferWriter = function(bw) {
  /* jshint maxstatements: 20 */

  // version
  bw.writeUInt32LE(this.version);

  // prevhash
  if (!this.prevHash) {
    bw.write(new Buffer(Array(32)));
  } else {
    var prevHashBuffer = new Buffer(this.prevHash, 'hex');
    prevHashBuffer = BufferReader(prevHashBuffer).readReverse();
    if (prevHashBuffer.length !== 32) {
      throw new Error('"prevHash" is expected to be 32 bytes');
    }
    bw.write(prevHashBuffer);
  }

  // merkleroot
  if (!this.merkleRoot) {
    bw.write(new Buffer(Array(32)));
  } else {
    var merkleRoot = new Buffer(this.merkleRoot, 'hex');
    merkleRoot = BufferReader(merkleRoot).readReverse();
    if (merkleRoot.length !== 32) {
      throw new Error('"merkleRoot" is expected to be 32 bytes');
    }
    bw.write(merkleRoot);
  }

  // timestamp
  bw.writeUInt32LE(Math.floor(this.timestamp.getTime() / 1000));

  // bits
  bw.writeUInt32LE(this.bits);

  // nonce
  bw.writeUInt32LE(this.nonce);

  return bw;

};

module.exports = Block;
