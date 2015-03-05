'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var Block = bitcore.Block;

// mocks

var mockBlocks = require('../test/data/blocks');

function Blocks() {}

var node;
Blocks.setNode = function(aNode) {
  node = aNode;
};


// params
Blocks.blockHashParam = function(req, res, next, blockHash) {
  // TODO: fetch block from service
  var block = mockBlocks[blockHash];
  
  if (_.isUndefined(block)) {
    res.status(404).send('Block ' + blockHash + ' not found');
    return;
  }
  req.block = block;
  next();
};


Blocks.getBlock = function(req, res) {
  res.send(req.block.toObject());
};

Blocks.getBlockError = function(req, res) {
  res.status(422);
  res.send('blockHash parameter must be a 64 digit hex');
};

module.exports = Blocks;
