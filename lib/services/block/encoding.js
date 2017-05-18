'use strict';

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.hashPrefix = new Buffer('00', 'hex');
  this.heightPrefix = new Buffer('01', 'hex');
}

Encoding.prototype.encodeBlockHashKey = function(hash) {
  return Buffer.concat([ this.servicePrefix, this.hashPrefix, new Buffer(hash, 'hex') ]);
};

Encoding.prototype.decodeBlockHashKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeBlockHashValue = function(hash) {
  return new Buffer(hash, 'hex');
};

Encoding.prototype.decodeBlockHashValue = function(buffer) {
  return buffer.toString('hex');
};

Encoding.prototype.encodeBlockHeightKey = function(height) {
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  return Buffer.concat([ this.servicePrefix, this.heightPrefix, heightBuf ]);
};

Encoding.prototype.decodeBlockHeightKey = function(buffer) {
  return buffer.slice(3).readUInt32BE();
};

Encoding.prototype.encodeBlockHeightValue = function(height) {
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  return heightBuf;
};

Encoding.prototype.decodeBlockHeightValue = function(buffer) {
  return buffer.readUInt32BE();
};

module.exports = Encoding;
