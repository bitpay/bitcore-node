'use strict';

var bitcore = require('bitcore');
var Block = bitcore.Block;

Object.values = function(obj) {
  var vals = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      vals.push(obj[key]);
    }
  }
  return vals;
};


var mockBlocks = {};
var blockHexs = require('./blocks.json');
blockHexs.map(function(hex) {
  var block = new Block(new Buffer(hex, 'hex'));
  return block;
}).forEach(function(block) {
  mockBlocks[block.id] = block;
});

module.exports = mockBlocks;
