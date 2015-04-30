'use strict';

var config = require('config');
var LevelUp = require('levelup');
var Promise = require('bluebird');
var RPC = require('bitcoind-rpc');
var bitcore = require('bitcore');
var BufferUtil = bitcore.util.buffer;
var Block = bitcore.Block;

var errors = require('../errors');
var BlockChain = require('../blockchain');
var genesisBlocks = require('../data/genesis');
var TransactionService = require('./transaction');

var $ = bitcore.util.preconditions;
var JSUtil = bitcore.util.js;
var _ = bitcore.deps._;

var helper = function(index) {
  return function(maybeHash) {
    if (_.isString(maybeHash)) {
      return index + maybeHash;
    } else if (bitcore.util.buffer.isBuffer(maybeHash)) {
      return index + maybeHash.toString('hex');
    } else if (maybeHash instanceof bitcore.Block) {
      return index + maybeHash.id;
    } else {
      throw new bitcore.errors.InvalidArgument();
    }
  };
};

var Index = {
  timestamp: 'bts-', // bts-<timestamp> -> hash for the block that was mined at this TS
  prev: 'prev-', // prev-<hash> -> parent hash
  next: 'nxt-', // nxt-<hash> -> hash for the next block in the main chain that is a child
  height: 'bh-', // bh-<hash> -> height (-1 means disconnected)
  tip: 'tip', // tip -> { hash: hex, height: int }, the latest tip
  work: 'wk-', // wk-<hash> -> amount of work for block
  header: 'header-' // header-<hash> -> JSON for block header
};
_.extend(Index, {
  getNextBlock: helper(Index.next),
  getPreviousBlock: helper(Index.prev),
  getBlockHeight: helper(Index.height),
  getBlockWork: helper(Index.work),
  getBlockByTs: function(block) {
    return Index.timestamp + block.header.time;
  },
  getBlockHeader: helper(Index.header),
});

function BlockService(opts) {
  opts = _.extend({}, opts);
  this.database = opts.database || Promise.promisifyAll(new LevelUp(config.get('LevelUp')));
  this.rpc = opts.rpc || Promise.promisifyAll(new RPC(config.get('RPC')));
  this.transactionService = opts.transactionService || new TransactionService({
    database: this.database,
    rpc: this.rpc
  });
}


/**
 * Transforms data as received from an RPC result structure for `getblock`,
 * plus a list of transactions, and build a block based on thosė.
 *
 * @param {Object} blockData
 * @param {Number} blockData.version a 32 bit number with the version of the block
 * @param {string} blockData.previousblockhash a string of length 64 with the hexa encoding of the
 *   hash for the previous block
 * @param {Number} blockData.time a 32 bit number with the timestamp when this block was created
 * @param {Number} blockData.nonce a 32 bit number with a random number
 * @param {string} blockData.bits a 32 bit "varint" encoded number with the length of the block
 * @param {string} blockData.merkleroot an hex string of length 64 with the hash of the block
 * @param {Array} transactions an array of bitcore.Transaction objects, in the order that forms the
 *   merkle root hash
 * @return {bitcore.Block}
 */
BlockService.blockRPCtoBitcore = function(blockData) {
  $.checkArgument(blockData, 'blockData is required');
  var block = new bitcore.Block({
    header: new bitcore.BlockHeader({
      version: blockData.version,
      prevHash: blockData.previousblockhash ?
        bitcore.util.buffer.reverse(
          new bitcore.deps.Buffer(blockData.previousblockhash, 'hex')
        ) : bitcore.util.buffer.emptyBuffer(32),
      time: blockData.time,
      nonce: blockData.nonce,
      bits: new bitcore.deps.bnjs(
        new bitcore.deps.Buffer(blockData.bits, 'hex')
      ).toNumber(),
      merkleRoot: bitcore.util.buffer.reverse(
        new bitcore.deps.Buffer(blockData.merkleroot, 'hex')
      )
    }),
    transactions: blockData.transactions
  });
  block.height = blockData.height;
  return block;
};

/**
 * A helper function to return an error when a block couldn't be found
 *
 * @param {*} err an error message or the block hash
 * @return {Promise} a promise that will always be rejected
 */
var blockNotFound = function(err) {
  if (err.message === 'Block not found' ||
    err.message === 'Block height out of range') {
    throw new errors.Blocks.NotFound();
  }
  throw err;
};

/**
 * Fetch a block using the hash of that block
 *
 * @param {string} blockHash the hash of the block to be fetched
 * @return {Promise<Block>}
 */
BlockService.prototype.getBlock = function(blockHash, opts) {
  $.checkArgument(
    JSUtil.isHexa(blockHash) || bitcore.util.buffer.isBuffer(blockHash),
    'Block hash must be a buffer or hexa'
  );
  if (bitcore.util.buffer.isBuffer(blockHash)) {
    blockHash = bitcore.util.buffer.reverse(blockHash).toString('hex');
  }
  opts = opts || {};

  var blockData;
  var self = this;

  return Promise.try(function() {
      return self.rpc.getBlockAsync(blockHash);
    })
    .catch(blockNotFound)
    .then(function(block) {

      blockData = block.result;

      if (opts.withoutTransactions) {
        return [];
      }

      return Promise.all(blockData.tx.map(function(txId) {
        return self.transactionService.getTransaction(txId);
      }));

    }).then(function(transactions) {

      blockData.transactions = transactions;
      return BlockService.blockRPCtoBitcore(blockData);

    });
};

/**
 * Fetch the block that is currently taking part of the main chain at a given height
 *
 * @param {Number} height the height of the block
 * @return {Promise<Block>}
 */
BlockService.prototype.getBlockByHeight = function(height) {
  $.checkArgument(_.isNumber(height), 'Block height must be a number');
  var self = this;
  if (height === 0) {
    return Promise.resolve(
      Block.fromBuffer(genesisBlocks[bitcore.Networks.defaultNetwork])
    );
  }

  return Promise.try(function() {
      return self.rpc.getBlockHashAsync(height);
    })
    .catch(blockNotFound)
    .then(function(result) {
      var blockHash = result.result;
      return self.getBlock(blockHash);
    });
};


/**
 * Returns a list of blocks given certain required query options.
 *
 * @param {Number} from block height as lower limit
 * @param {Number} to ditto, but for the upper limit, non inclusive
 * @param {Number} offset skip the first offset blocks
 * @param {Number} limit max amount of blocks returned
 * @return {Array} a list of blocks
 *
 */
BlockService.prototype.listBlocks = function(from, to, offset, limit) {
  $.checkArgument(_.isNumber(from), 'from is required, and must be a number');
  $.checkArgument(_.isNumber(to), 'to is required, and must be a number');
  $.checkArgument(_.isNumber(offset), 'offset is required, and must be a number');
  $.checkArgument(_.isNumber(limit), 'limit is required, and must be a number');
  $.checkArgument(from <= to, 'from must be <= to');

  var self = this;
  var start = from + offset;
  var end = Math.min(to, start + limit);
  var blocks = [];
  //console.log(from, to, offset, limit);
  //console.log(start, end);
  // TODO: optimize: precompute heights and fetch all blocks in parallel?
  var fetchBlock = function(height) {
    if (height >= end) {
      return Promise.resolve();
    }
    return self.getBlockByHeight(height)
      .then(function(block) {
        blocks.push(block);
        return fetchBlock(height + 1);
      })
      .catch(function(err) {
        // block not found, ignore
      });
  };
  return fetchBlock(start)
    .then(function() {
      return blocks;
    });
};

BlockService.prototype._getLatestHash = function() {
  var self = this;
  return Promise.try(function() {
    return self.database.getAsync(Index.tip);
  }).catch(function(error) {
    if (error.toString() !== 'NotFoundError: Key not found in database [tip]') {
      throw error;
    }
    return null;
  });
};
/**
 * Fetch the block that is currently the tip of the blockchain
 *
 * @return {Promise<Block>}
 */
BlockService.prototype.getLatest = function() {
  var self = this;
  return this._getLatestHash().then(function(blockHash) {
    if (!blockHash) {
      return null;
    }
    return self.getBlock(blockHash);
  });
};

/**
 * Handle a block from the network
 *
 * @param {bitcore.Block} block
 * @return a list of events back to the event bus
 */
BlockService.prototype.onBlock = function(block) {
  var events = [];
  return this.save(block)
    .then(function(block) {
      console.log('block', block.id, 'saved with height', block.height);
      block.transactions.forEach(function(tx) {
        events.push(tx);
      });
      return events;
    });
};


/**
 * Set a block as the current tip of the blockchain
 *
 * @param {bitcore.Block} block
 * @param {Array=} ops
 * @return {Promise<Block>} a promise of the same block, for chaining
 */
BlockService.prototype.confirm = function(block, ops) {
  $.checkArgument(block instanceof bitcore.Block);

  var self = this;

  ops = ops || [];

  //console.log(0);
  return Promise.try(function() {
      //console.log(0.5);
      self._setHeader(ops, block);
      //console.log(1);
      self._setNextBlock(ops, block.header.prevHash, block);

      //console.log(3);
      self._setBlockHeight(ops, block);

      //console.log(3);
      self._setBlockWork(ops, block);

      //console.log(4);
      self._setBlockByTs(ops, block);

      //console.log(4.1);
      self._setTip(ops, block);

      //console.log(5);
      return Promise.all(block.transactions.map(function(transaction) {
        return self.transactionService._confirmTransaction(ops, block, transaction);
      }));

    })
    .then(function() {
      //console.log(6);
      return self.database.batchAsync(ops);
    })
    .then(function() {
      //console.log(7);
      return block;
    });
};

BlockService.prototype._setHeader = function(ops, block) {
  ops.push({
    type: 'put',
    key: Index.getBlockHeader(block.hash),
    value: block.header.toJSON(),
  });
};

BlockService.prototype._setNextBlock = function(ops, prevBlockHash, block) {
  if (bitcore.util.buffer.isBuffer(prevBlockHash)) {
    prevBlockHash = bitcore.util.buffer.reverse(prevBlockHash).toString('hex');
  }
  ops.push({
    type: 'put',
    key: Index.getNextBlock(prevBlockHash),
    value: block.hash
  });
  ops.push({
    type: 'put',
    key: Index.getPreviousBlock(block.hash),
    value: prevBlockHash
  });
};

BlockService.prototype._setBlockHeight = function(ops, block) {
  ops.push({
    type: 'put',
    key: Index.getBlockHeight(block),
    value: block.height
  });
};

BlockService.prototype._setTip = function(ops, block) {
  ops.push({
    type: 'put',
    key: Index.tip,
    value: block.hash
  });
};

BlockService.prototype._setBlockWork = function(ops, block) {
  ops.push({
    type: 'put',
    key: Index.getBlockWork(block),
    value: block.work
  });
};

BlockService.prototype._setBlockByTs = function(ops, block) {

  // TODO: uncomment this
  /*
  var self = this;
  var key = Index.timestamp + block.header.time;
  console.log('key', key);

  return Promise.try(function() {

    console.log('a');
    return self.database.getAsync(key);

  })
  .then(function(result) {

    console.log('b');
    if (result === block.hash) {
      return Promise.resolve();
    } else {
      // TODO: Retry or provide a strategy to insert correctly the block
      throw new Error('Found blocks that have same timestamp');
    }

  })
  .error(function(err) {
    console.log('err', err);

    // TODO: Check if err is not found
    return ops.push({
      type: 'put',
      key: Index.getBlockByTs(block),
      value: block.hash
    });
  });
  */
};

/**
 * Unconfirm a block
 *
 * @param {bitcore.Block} block
 * @param {Array=} ops
 * @return {Promise<Block>} a promise of the same block, for chaining
 */
BlockService.prototype.unconfirm = function(block, ops) {
  ops = ops || [];
  var self = this;

  return Promise.try(function() {

    self._removeNextBlock(ops, block.header.prevHash, block);
    self._unsetBlockHeight(ops, block, block.height);
    self._dropBlockByTs(ops, block);

    return Promise.all(block.transactions.map(function(transaction) {
      return self.transactionService._unconfirmTransaction(ops, block, transaction);
    }));

  }).then(function() {
    return self.database.batchAsync(ops);
  });
};

BlockService.prototype._removeNextBlock = function(ops, prevHash, block) {

  if (bitcore.util.buffer.isBuffer(prevHash)) {
    prevHash = bitcore.util.buffer.reverse(prevHash).toString('hex');
  }

  ops.push({
    type: 'del',
    key: Index.getNextBlock(prevHash)
  });
  ops.push({
    type: 'del',
    key: Index.getPreviousBlock(block.hash)
  });
};

BlockService.prototype._unsetBlockHeight = function(ops, block) {
  ops.push({
    type: 'del',
    key: Index.getBlockHeight(block)
  });
};

BlockService.prototype._dropBlockByTs = function(ops, block) {
  // TODO
};

/**
 * Retrieve the block hash that forms part of the current main chain that confirmed a given
 * transaction.
 *
 * @param {bitcore.Transaction} transaction
 * @return {Promise<string>} a promise of the hash of the block
 */
BlockService.prototype.getBlockHashForTransaction = function(transaction) {

  return this.database.getAsync(Index.getBlockForTransaction(transaction))
    .error(function(error) {
      // TODO: Handle error
    });
};

/**
 * Retrieve the block that forms part of the current main chain that confirmed a given transaction.
 *
 * @param {bitcore.Transaction} transaction
 * @return {Promise<Block>} a promise of a block
 */
BlockService.prototype.getBlockForTransaction = function(transaction) {
  if (transaction instanceof bitcore.Transaction) {
    transaction = transaction.id;
  }
  $.checkArgument(_.isString(transaction));
  var self = this;

  return self.getBlockHashForTransaction(transaction).then(function(hash) {
    return self.getBlock(hash);
  });
};

BlockService.prototype.getBlockchain = function() {
  var self = this;

  var blockchain = new BlockChain();
  var headers = [];

  console.log('Fetching headers from db...');
  var fetchHeader = function(blockHash) {
    if (blockHash === BlockChain.NULL) {
      console.log('All headers fetched, total =', headers.length);
      console.log(process.memoryUsage().heapTotal / 1024 / 1024, 'mb used');
      return;
    }
    var headerKey = Index.getBlockHeader(blockHash);
    return self.database.getAsync(headerKey)
      .then(function(json) {
        return bitcore.Block.BlockHeader.fromJSON(json);
      })
      .then(function(header) {
        headers.push(header);
        return fetchHeader(BufferUtil.reverse(header.prevHash).toString('hex'));
      });
  };

  return self._getLatestHash()
    .then(function(tip) {
      if (!tip) {
        console.log('No tip found, syncing blockchain from genesis block');
        return null;
      }
      console.log('Tip is', tip);
      return fetchHeader(tip)
        .then(function() {
          while (headers.length !== 0) {
            var header = headers.pop();
            blockchain.proposeNewHeader(header);
          }
          return blockchain;
        });
    });
};

module.exports = BlockService;
