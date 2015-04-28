'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;

var BitcoreNode = require('../../');

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
  node.blockService.getBlock(blockHash)
    .then(function(block) {
      req.block = block;
    })
    .then(next)
    .catch(BitcoreNode.errors.Blocks.NotFound, function() {
      res.status(404).send('Block with id ' + blockHash + ' not found');
    });
};

/*
 * Finds a block by its height
 */
Blocks.heightParam = function(req, res, next, height) {
  height = parseInt(height);
  node.blockService.getBlockByHeight(height)
    .then(function(block) {
      req.block = block;
    })
    .then(next)
    .catch(BitcoreNode.errors.Blocks.NotFound, function() {
      res.status(404).send('Block with height ' + height + ' not found');
    });
};


/*
 * controllers
 */

/*
 * Returns a list of blocks given certain query options.
 *
 * from: block height as lower limit (default: 0)
 * to: ditto, but for the upper limit, non inclusive (default: 1000000)
 * offset: skip the first offset blocks (default: 0)
 * limit: max amount of blocks returned (default: 10)
 *
 */
Blocks.list = function(req, res) {
  var from = parseInt(req.query.from || 0);
  var to = parseInt(req.query.to || 1e6);
  var offset = parseInt(req.query.offset || 0);
  var limit = parseInt(req.query.limit || 10);

  if (to < from) {
    res.status(422);
    res.send('/v1/blocks/ "to" must be >= "from"');
    return;
  }
  // TODO: add more parameter validation

  // TODO: return block_summary instead of block_full
  node.blockService.listBlocks(from, to, offset, limit)
    .then(function(blocks) {
      res.send(blocks);
    });
};

Blocks.getLatest = function(req, res) {
  node.blockService.getLatest()
    .then(function(block) {
      req.block = block;
      Blocks.get(req, res);
    });
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
