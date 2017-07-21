'use strict';

var Block = require('bcoin').block;
// stores -- block header as key, block itself as value (optionally)

function Encoding(servicePrefix) {
  this._servicePrefix = servicePrefix;
}


// ---- hash --> rawblock
Encoding.prototype.encodeBlockKey = function(hash) {
  return Buffer.concat([ this._servicePrefix, new Buffer(hash, 'hex') ]);
};

Encoding.prototype.decodeBlockKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeBlockValue = function(block) {
  return block.toRaw();
};

Encoding.prototype.decodeBlockValue = function(buffer) {
  return Block.fromRaw(buffer);
};

module.exports = Encoding;
