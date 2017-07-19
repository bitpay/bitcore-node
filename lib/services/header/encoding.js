'use strict';


function Encoding(servicePrefix) {
  this._servicePrefix = servicePrefix;
}


// ---- hash --> header
Encoding.prototype.encodeHeaderKey = function(hash) {
  return Buffer.concat([ this._servicePrefix, new Buffer(hash, 'hex') ]);
};

Encoding.prototype.decodeHeaderKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeHeaderValue = function(header) {
  var versionBuf = new Buffer(4);
  versionBuf.writeInt32BE(header.version);
  var prevHash = new Buffer(header.prevHash, 'hex');
  var merkleRoot = new Buffer(header.merkleRoot, 'hex');
  var tsBuf = new Buffer(4);
  tsBuf.writeUInt32BE(header.timestamp);
  var bitsBuf = new Buffer(4);
  bitsBuf.writeUInt32BE(header.bits);
  var nonceBuf = new Buffer(4);
  nonceBuf.writeUInt32BE(header.nonce);
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(header.height);
  return Buffer.concat([ versionBuf, prevHash, merkleRoot, tsBuf, bitsBuf, nonceBuf, heightBuf ]);
};

Encoding.prototype.decodeHeaderValue = function(buffer) {
  var version = buffer.readInt32BE();
  var prevHash = buffer.slice(4, 36).toString('hex');
  var merkleRoot = buffer.slice(36, 68).toString('hex');
  var ts = buffer.readUInt32BE(68);
  var bits = buffer.readUInt32BE(72);
  var nonce = buffer.readUInt32BE(76);
  var height = buffer.readUInt32BE(80);
  return {
    version: version,
    prevHash: prevHash,
    merkleRoot: merkleRoot,
    timestamp: ts,
    bits: bits,
    nonce: nonce,
    height: height
  };
};

module.exports = Encoding;

