'use strict';

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeBlockTimestampKey = function(hash) {
  return Buffer.concat([this.servicePrefix, new Buffer(hash, 'hex')]);
};

Encoding.prototype.decodeBlockTimestampKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeBlockTimestampValue = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return timestampBuffer;
};

Encoding.prototype.decodeBlockTimestampValue = function(buffer) {
  return buffer.readDoubleBE(0);
};

Encoding.prototype.encodeTimestampBlockKey = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return Buffer.concat([this.servicePrefix, timestampBuffer]);
};

Encoding.prototype.decodeTimestampBlockKey = function(buffer) {
  return buffer.readDoubleBE(2);
};

Encoding.prototype.encodeTimestampBlockValue = function(hash) {
  return new Buffer(hash, 'hex');
};

Encoding.prototype.decodeTimestampBlockValue = function(buffer) {
  return buffer.toString('hex');
};

module.exports = Encoding;
