'use strict';

var LevelUp = require('levelup');
var Promise = require('bluebird');
var RPC = require('bitcoind-rpc');
var TransactionService = require('./transaction');
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;
var config = require('config');

var errors = require('../errors');

var $ = bitcore.util.preconditions;
var JSUtil = bitcore.util.js;
var _ = bitcore.deps._;

var NULLBLOCKHASH = bitcore.util.buffer.emptyBuffer(32).toString('hex');
var GENESISPARENT = {
  height: -1,
  prevBlockHash: NULLBLOCKHASH
};

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
  blockchain: 'chain'
};
_.extend(Index, {
  getNextBlock: helper(Index.next),
  getPreviousBlock: helper(Index.prev),
  getBlockHeight: helper(Index.height),
  getBlockByTs: function(block) {
    return Index.timestamp + block.header.time;
  }
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
      ),
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
 * @param {*} err
 * @return {Promise} a promise that will always be rejected
 */
var blockNotFound = function(err) {
  throw new errors.Blocks.NotFound(err);
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
 * Fetch the block that is currently the tip of the blockchain
 *
 * @return {Promise<Block>}
 */
BlockService.prototype.getLatest = function() {

  var self = this;

  return Promise.try(function() {

    return self.database.getAsync(Index.tip);

  }).then(function(blockHash) {

    return self.getBlock(blockHash);

  }).catch(LevelUp.errors.NotFoundError, function() {
    return null;
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
 * Save a new block
 *
 * @param {bitcore.Block} block
 * @return {Promise<Block>} a promise of the same block, for chaining
 */
BlockService.prototype.unconfirm = function(block) {
  // TODO: unconfirm previous tip, confirm new tip. 
};


/**
 * Set a block as the current tip of the blockchain
 *
 * @param {bitcore.Block} block
 * @return {Promise<Block>} a promise of the same block, for chaining
 */
BlockService.prototype.confirm = function(block) {
  $.checkArgument(block instanceof bitcore.Block);

  var self = this;

  var ops = [];

  return Promise.try(function() {
      //console.log(1);
      return self._setNextBlock(ops, block.header.prevHash, block);

    }).then(function() {
      //console.log(2);

      if (block.header.prevHash.toString('hex') !== NULLBLOCKHASH) {
        //console.log(2.1);
        return self.getBlock(block.header.prevHash, {
          withoutTransactions: true
        });
      } else {
        //console.log(2.2);
        return GENESISPARENT;
      }

    }).then(function(parent) {
      //console.log(3);

      return self._setBlockHeight(ops, block, parent.height + 1);

    }).then(function() {
      //console.log(4);

      return self._setBlockByTs(ops, block);

    }).then(function() {
      //console.log(5);

      return Promise.all(block.transactions.map(function(transaction) {
        return self.transactionService._confirmTransaction(ops, block, transaction);
      }));

    }).then(function() {
      //console.log(6);
      var p = self.database.batchAsync(ops);
      //console.log(6.5);
      return p;

    })
    .then(function() {
      //console.log(7);
      return block;
    });
};

BlockService.prototype._setNextBlock = function(ops, prevBlockHash, block) {
  if (bitcore.util.buffer.isBuffer(prevBlockHash)) {
    prevBlockHash = bitcore.util.buffer.reverse(prevBlockHash).toString('hex');
  }
  return Promise.try(function() {
    ops.push({
      type: 'put',
      key: Index.getNextBlock(prevBlockHash),
      value: block.hash
    });
    ops.push({
      type: 'put',
      key: Index.getPreviousBlock(block.hash),
      value: prevBlockHash.toString('hex')
    });
  });
};

BlockService.prototype._setBlockHeight = function(ops, block, height) {
  block.height = height;
  return Promise.try(function() {
    ops.push({
      type: 'put',
      key: Index.getBlockHeight(block),
      value: height
    });
    return ops;
  });
};

BlockService.prototype._setBlockByTs = function(ops, block) {
  var self = this;
  var key = Index.timestamp + block.time;

  return Promise.try(function() {

    return self.database.getAsync(key);

  }).then(function(result) {

    if (result === block.hash) {
      return Promise.resolve();
    } else {
      // TODO: Retry or provide a strategy to insert correctly the block
      throw new Error('Found blocks that have same timestamp');
    }

  }).error(function(err) {
    // TODO: Check if err is not found
    return ops.push({
      type: 'put',
      key: Index.getBlockByTs(block),
      value: block.hash
    });
  });
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
  return new Promise(function(resolve, reject) {
    self.database.getAsync(Index.blockchain).then(function(blockchain) {
      blockchain = BlockChain.fromObject(JSON.parse(blockchain));
      return resolve(blockchain);
    }).catch(function(arg) {
      if (arg.message.indexOf('Key not found in database') !== -1) {
        return resolve();
      }
      return reject(arg);
    });
  });
};

BlockService.prototype.saveBlockchain = function(blockchain) {
  return this.database.putAsync({
    key: Index.blockchain,
    value: blockchain.toJSON()
  });
};

module.exports = BlockService;
