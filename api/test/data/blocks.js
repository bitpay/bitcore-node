'use strict';

var bitcore = require('bitcore');
var Block = bitcore.Block;

var mockBlocks = {};
var blockHexs = require('./blocks.json');
blockHexs.map(function(hex) {
  var block = new Block(new Buffer(hex, 'hex'));
  return block;
}).forEach(function(block) {
  mockBlocks[block.id] = block.toObject();
});

module.exports = mockBlocks;
