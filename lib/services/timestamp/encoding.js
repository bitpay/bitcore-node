'use strict';

function Encoding(servicePrefix) {
  this._servicePrefix = servicePrefix;
  this._blockPrefix = new Buffer('00', 'hex');
  this._timestampPrefix = new Buffer('01', 'hex');
}

// ----  block hash -> timestamp
Encoding.prototype.encodeBlockTimestampKey = function(hash) {
  return Buffer.concat([this._servicePrefix, this._blockPrefix, new Buffer(hash, 'hex')]);
};

Encoding.prototype.decodeBlockTimestampKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeBlockTimestampValue = function(timestamp) {
  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp);
  return timestampBuffer;
};

Encoding.prototype.decodeBlockTimestampValue = function(buffer) {
  return buffer.readUInt32BE();
};


// ---- timestamp -> block hash
Encoding.prototype.encodeTimestampBlockKey = function(timestamp) {
  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp);
  return Buffer.concat([this._servicePrefix, this._timestampPrefix, timestampBuffer]);
};

Encoding.prototype.decodeTimestampBlockKey = function(buffer) {
  return buffer.readUInt32BE(3);
};

Encoding.prototype.encodeTimestampBlockValue = function(hash) {
  return new Buffer(hash, 'hex');
};

Encoding.prototype.decodeTimestampBlockValue = function(buffer) {
  return buffer.toString('hex');
};

module.exports = Encoding;
