'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;

var Blocks = {};

var node;
Blocks.setNode = function(aNode) {
  node = aNode;
};


/*
 *  params
 */

/*
 * Finds a block by its hash
 */
Blocks.blockHashParam = function(req, res, next, blockHash) {
  var block = node.getBlock(blockHash);

  if (_.isUndefined(block)) {
    res.status(404).send('Block with id ' + blockHash + ' not found');
    return;
  }
  req.block = block;
  next();
};

/*
 * Finds a block by its height
 */
Blocks.heightParam = function(req, res, next, height) {
  height = parseInt(height);
  var block = node.getBlock(height);

  if (_.isUndefined(block)) {
    res.status(404).send('Block with height ' + height + ' not found');
    return;
  }
  req.block = block;
  next();
};


/*
 * controllers
 */

Blocks.getLatest = function(req, res) {
  req.block = node.getLatestBlock();
  Blocks.get(req, res);
};

Blocks.get = function(req, res) {
  $.checkState(req.block instanceof Block);
  res.send(req.block.toObject());
};
Blocks.getBlockError = function(req, res) {
  res.status(422);
  res.send('/v1/blocks/ parameter must be a 64 digit hex or block height integer');
};

module.exports = Blocks;
