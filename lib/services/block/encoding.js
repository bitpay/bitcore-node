'use strict';

var Block = require('bitcore-lib').Block;
// stores -- block header as key, block itself as value (optionally)

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.blockPrefix = new Buffer('00', 'hex');
  this.hashPrefix = new Buffer('01', 'hex');
  this.heightPrefix = new Buffer('02', 'hex');
}


// ---- hash --> block
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


// ---- hash --> header
Encoding.prototype.encodeHashKey = function(hash) {
  var hashBuf = new Buffer(hash, 'hex');
  return Buffer.concat([ this.servicePrefix, this.hashPrefix, hashBuf ]);
};

Encoding.prototype.decodeHashKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeHeaderValue = function(header) {
  return new Buffer(JSON.stringify(header), 'utf8');
};

Encoding.prototype.decodeHeaderValue = function(buffer) {
  return JSON.parse(buffer.toString('utf8'));
};


// ---- height --> header
Encoding.prototype.encodeHeightKey = function(height) {

  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  return Buffer.concat([ this.servicePrefix, this.heightPrefix, heightBuf ]);

};

Encoding.prototype.decodeHeightKey = function(buffer) {
  return buffer.readUInt32BE(3);
};


module.exports = Encoding;
