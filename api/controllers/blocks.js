'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;

// mocks

var mockBlocks = require('../test/data/blocks');

var Blocks = {};

var node;
Blocks.setNode = function(aNode) {
  node = aNode;
};


// params
Blocks.blockHashParam = function(req, res, next, blockHash) {
  // TODO: fetch block from service
  var block = mockBlocks[blockHash];

  if (_.isUndefined(block)) {
    res.status(404).send('Block with id ' + blockHash + ' not found');
    return;
  }
  req.block = block;
  next();
};

Blocks.heightParam = function(req, res, next, height) {
  // TODO: fetch block from service
  height = parseInt(height);
  var block = mockBlocks[Object.keys(mockBlocks)[height]];

  if (_.isUndefined(block)) {
    res.status(404).send('Block with height ' + height + ' not found');
    return;
  }
  req.block = block;
  next();
};

Blocks.getBlock = function(req, res) {
  $.checkState(req.block instanceof Block);
  res.send(req.block.toObject());
};

Blocks.getBlockError = function(req, res) {
  res.status(422);
  res.send('/v1/blocks/ parameter must be a 64 digit hex or block height integer');
};

module.exports = Blocks;
