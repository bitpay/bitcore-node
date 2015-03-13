'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;

var mockTransactions = {};
var blocks = require('./blocks');
_.each(blocks, function(block) {
  block.transactions.forEach(function(tx) {
    mockTransactions[tx.id] = tx;
  });
});

module.exports = mockTransactions;
