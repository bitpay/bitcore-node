'use strict';


function Encoding(servicePrefix) {
  this._servicePrefix = servicePrefix;
  this._hashPrefix = new Buffer('00', 'hex');
  this._heightPrefix = new Buffer('01', 'hex');
}

// ---- hash --> header
Encoding.prototype.encodeHeaderHashKey = function(hash) {
  var hashBuf = new Buffer(hash, 'hex');
  return Buffer.concat([ this._servicePrefix, this._hashPrefix, hashBuf ]);
};

Encoding.prototype.decodeHeaderHashKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

// ---- height --> header
Encoding.prototype.encodeHeaderHeightKey = function(height) {
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(height);
  return Buffer.concat([ this._servicePrefix, this._heightPrefix, heightBuf ]);
};

Encoding.prototype.decodeHeaderHeightKey = function(buffer) {
  return buffer.readUInt32BE(3);
};

Encoding.prototype.encodeHeaderValue = function(header) {
  var hashBuf = new Buffer(header.hash, 'hex');
  var versionBuf = new Buffer(4);
  versionBuf.writeInt32BE(header.version);
  var prevHash = new Buffer(header.prevHash, 'hex');
  var merkleRoot = new Buffer(header.merkleRoot, 'hex');
  var tsBuf = new Buffer(4);
  tsBuf.writeUInt32BE(header.timestamp || header.time);
  var bitsBuf = new Buffer(4);
  bitsBuf.writeUInt32BE(header.bits);
  var nonceBuf = new Buffer(4);
  nonceBuf.writeUInt32BE(header.nonce);
  var heightBuf = new Buffer(4);
  heightBuf.writeUInt32BE(header.height);
  var chainworkBuf = new Buffer(header.chainwork, 'hex');
  var nextHash = new Buffer(header.nextHash || new Array(65).join('0'), 'hex');
  return Buffer.concat([
    hashBuf,
    versionBuf,
    prevHash,
    merkleRoot,
    tsBuf,
    bitsBuf,
    nonceBuf,
    heightBuf,
    chainworkBuf,
    nextHash
  ]);
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
  var chainwork = buffer.slice(116, 116 + 32).toString('hex');
  var nextHash = buffer.slice(116 + 32).toString('hex');
  return {
    hash: hash,
    version: version,
    prevHash: prevHash,
    merkleRoot: merkleRoot,
    timestamp: ts,
    bits: bits,
    nonce: nonce,
    height: height,
    chainwork: chainwork,
    nextHash: nextHash
  };
};

module.exports = Encoding;

