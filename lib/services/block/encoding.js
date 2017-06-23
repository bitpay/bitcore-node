'use strict';

var Block = require('bitcore-lib').Block;
// stores -- block header as key, block itself as value (optionally)

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeBlockKey = function(header) {
  var headerBuf = new Buffer(JSON.stringify(header), 'utf8');
  return Buffer.concat([ this.servicePrefix, headerBuf ]);
};

Encoding.prototype.decodeBlockKey = function(buffer) {
  return JSON.parse(buffer.slice(2).toString('utf8'));
};

Encoding.prototype.encodeBlockValue = function(block) {
  return block.toBuffer();
};

Encoding.prototype.decodeBlockValue = function(buffer) {
  return Block.fromBuffer(buffer);
};

module.exports = Encoding;
