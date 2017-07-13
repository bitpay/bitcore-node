'use strict';

var Block = require('bitcore-lib').Block;
// stores -- block header as key, block itself as value (optionally)

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.blockPrefix = new Buffer('00', 'hex');
  this.metaPrefix = new Buffer('01', 'hex');
}


// ---- hash --> rawblock
Encoding.prototype.encodeBlockKey = function(hash) {
  return Buffer.concat([ this.servicePrefix, this.blockPrefix, new Buffer(hash, 'hex') ]);
};

Encoding.prototype.decodeBlockKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeBlockValue = function(block) {
  return block.toBuffer();
};

Encoding.prototype.decodeBlockValue = function(buffer) {
  return Block.fromBuffer(buffer);
};

// ---- height --> hash, chainwork
Encoding.prototype.encodeMetaKey = function(height) {
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  return Buffer.concat([ this.blockPrefix, this.metaPrefix, heightBuf ]);
};

Encoding.prototype.decodeMetaKey = function(buffer) {
  return buffer.readUInt32BE(3);
};

Encoding.prototype.encodeMetaValue = function(value) {
  // { chainwork: hex-string, hash: hex-string }
  return Buffer([ new Buffer(value.hash, 'hex'), new Buffer(value.chainwork, 'hex') ]);
};

Encoding.prototype.decodeMetaValue = function(buffer) {
  return {
    hash: buffer.slice(0, 32).toString('hex'),
    chainwork: buffer.slice(32).toString('hex')
  };
};

module.exports = Encoding;
