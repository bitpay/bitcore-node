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
  return Buffer.concat([ versionBuf, prevHash.reverse(), merkleRoot.reverse(), tsBuf, bitsBuf, nonceBuf, heightBuf, chainworkBuf ]);
};

Encoding.prototype.decodeHeaderValue = function(buffer) {
  var version = buffer.readInt32BE();
  var prevHash = buffer.slice(4, 36).toString('hex');
  var merkleRoot = buffer.slice(36, 68).toString('hex');
  var ts = buffer.readUInt32BE(68);
  var bits = buffer.readUInt32BE(72);
  var nonce = buffer.readUInt32BE(76);
  var height = buffer.readUInt32BE(80);
  var chainwork = buffer.slice(84).toString('hex');
  return {
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

