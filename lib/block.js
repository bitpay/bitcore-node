'use strict';

var bitcore = require('bitcore');
var BufferReader = bitcore.encoding.BufferReader;
var BufferWriter = bitcore.encoding.BufferWriter;
var Hash = bitcore.crypto.Hash;

//TODO: use bitcore.Block

function Block(obj) {
  /* jshint maxstatements: 25 */
  if (!(this instanceof Block)) {
    return new Block(obj);
  }

  this.version = obj.version || 1;
  this.prevHash = obj.prevHash;

  if (!obj.hasOwnProperty('prevHash')) {
    throw new TypeError('"prevHash" is expected');
  }
  if (!obj.timestamp) {
    throw new TypeError('"timestamp" is expected');
  }
  this.timestamp = obj.timestamp;
  if (typeof this.timestamp === 'string') {
    this.timestamp = new Date(obj.timestamp);
  }

  this.merkleRoot = obj.merkleRoot;

  if (obj.data) {
    if (!Buffer.isBuffer(obj.data)) {
      throw new TypeError('"data" is expected to be a buffer');
    }
    this.data = obj.data;
  } else {
    this.data = new Buffer(0);
  }

  var hashProperty = {
    configurable: false,
    enumerable: true,
    get: function() {
      return this.getHash();
    },
    set: function() {}
  };

  Object.defineProperty(this, 'hash', hashProperty);

  this.bits = obj.bits;
  this.nonce = obj.nonce || 0;

  return this;
}

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

Block.prototype.validate = function(chain, callback) {
  // bitcoind does all validation
  setImmediate(callback);
};

Block.prototype.headerToBuffer = function() {
  var bw = new BufferWriter();
  this.headerToBufferWriter(bw);
  return bw.concat();
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

Block.prototype.toObject = Block.prototype.toJSON = function() {
  return {
    hash: this.hash,
    version: this.version,
    prevHash: this.prevHash,
    merkleRoot: this.merkleRoot,
    timestamp: this.timestamp.toISOString(),
    bits: this.bits,
    nonce: this.nonce,
    data: this.data.toString('hex')
  };
};

Block.prototype.toBufferWriter = function(bw) {
  // header
  this.headerToBufferWriter(bw);

  // transaction data
  bw.write(this.data);
  return bw;
};

Block.prototype.toBuffer = function() {
  var bw = new BufferWriter();
  this.toBufferWriter(bw);
  return bw.concat();
};

Block.prototype.getHash = function() {
  var hashBuffer = BufferReader(Hash.sha256sha256(this.headerToBuffer())).readReverse();
  var hash = hashBuffer.toString('hex');
  return hash;
};

module.exports = Block;
