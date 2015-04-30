'use strict';

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;

var errors = require('../../lib/errors');

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
    .catch(errors.Blocks.NotFound, function() {
      res.status(404).send('Block with id ' + blockHash + ' not found');
    })
    .catch(function() {
      console.log(arguments);
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
    .catch(errors.Blocks.NotFound, function() {
      res.status(404).send('Block with height ' + height + ' not found');
    })
    .catch(function() {
      console.log(arguments);
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

  if (from < 0) {
    res.status(422);
    res.send('/v1/blocks/ "from" must be valid block height (a positive integer)');
    return;
  }
  if (to < 0) {
    res.status(422);
    res.send('/v1/blocks/ "to" must be valid block height (a positive integer)');
    return;
  }
  if (offset < 0) {
    res.status(422);
    res.send('/v1/blocks/ "offset" must be a positive integer');
    return;
  }
  if (limit < 0) {
    res.status(422);
    res.send('/v1/blocks/ "limit" must be a positive integer');
    return;
  }
  if (to < from) {
    res.status(422);
    res.send('/v1/blocks/ "to" must be >= "from"');
    return;
  }

  // TODO: return block_summary instead of block_full
  node.blockService.listBlocks(from, to, offset, limit)
    .then(function(blocks) {
      res.send(blocks.map(function(b) {
        return b.toObject();
      }));
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
  $.checkState(req.block instanceof Block, JSON.stringify(req.block));
  res.send(req.block.toObject());
};

Blocks.getBlockError = function(req, res) {
  res.status(422);
  res.send('/v1/blocks/ parameter must be a 64 digit hex or block height integer');
};

module.exports = Blocks;
