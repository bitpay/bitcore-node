'use strict';


function Encoding(servicePrefix) {
  this._servicePrefix = servicePrefix;
}


// ---- hash --> header
Encoding.prototype.encodeHeaderKey = function(height, hash) {
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  var hashBuf = new Buffer(hash || new Array(65).join('0'), 'hex');
  return Buffer.concat([ this._servicePrefix, heightBuf, hashBuf ]);
};

Encoding.prototype.decodeHeaderKey = function(buffer) {
  var height = buffer.readUInt32BE(2);
  return {
    height: height,
    hash: buffer.slice(6).toString('hex')
  };

};

Encoding.prototype.encodeHeaderValue = function(header) {
  var hashBuf = new Buffer(header.hash, 'hex');
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
  var chainworkBuf = new Buffer(header.chainwork, 'hex');
  return Buffer.concat([hashBuf, versionBuf, prevHash, merkleRoot, tsBuf, bitsBuf, nonceBuf, heightBuf, chainworkBuf ]);
};

Encoding.prototype.decodeHeaderValue = function(buffer) {
  var hash = buffer.slice(0, 32).toString('hex');
  var version = buffer.readInt32BE(32);
  var prevHash = buffer.slice(36, 68).toString('hex');
  var merkleRoot = buffer.slice(68, 100).toString('hex');
  var ts = buffer.readUInt32BE(100);
  var bits = buffer.readUInt32BE(104);
  var nonce = buffer.readUInt32BE(108);
  var height = buffer.readUInt32BE(112);
  var chainwork = buffer.slice(116).toString('hex');
  return {
    hash: hash,
    version: version,
    prevHash: prevHash,
    merkleRoot: merkleRoot,
    timestamp: ts,
    bits: bits,
    nonce: nonce,
    height: height,
    chainwork: chainwork
  };
};

module.exports = Encoding;

