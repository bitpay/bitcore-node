'use strict';

var bitcore = require('bitcore');
var Block = bitcore.Block;

var mockTransactions = {};
var blockHexs = require('./blocks.json');
blockHexs.map(function(hex) {
  var block = new Block(new Buffer(hex, 'hex'));
  return block;
}).forEach(function(block) {
  block.transactions.forEach(function(tx) {
    mockTransactions[tx.id] = tx;
  });
});

module.exports = mockTransactions;
