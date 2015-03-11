'use strict';

var bitcore = require('bitcore');

var mockTransactions = {};
var blocks = require('./blocks');
Object.values(blocks).forEach(function(block) {
  block.transactions.forEach(function(tx) {
    mockTransactions[tx.id] = tx;
  });
});

module.exports = mockTransactions;
