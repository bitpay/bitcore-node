'use strict';

var LevelUp = require('levelup');
var Promise = require('bluebird');
var RPC = require('bitcoind-rpc');
var TransactionService = require('./transaction');
var bitcore = require('bitcore');
var config = require('config');

var $ = bitcore.util.preconditions;
var JSUtil = bitcore.util.js;
var _ = bitcore.deps._;

var LATEST_BLOCK = 'latest-block';

function BlockService (opts) {
  opts = _.extend({}, opts);
  this.database = opts.database || Promise.promisifyAll(new LevelUp(config.get('LevelUp')));
  this.rpc = opts.rpc || Promise.promisifyAll(new RPC(config.get('RPC')));
  this.transactionService = opts.transactionService || new TransactionService({
    database: this.database,
    rpc: this.rpc
  });
}

BlockService.blockRPCtoBitcore = function(blockData, transactions) {
  $.checkArgument(_.all(transactions, function(transaction) {
    return transaction instanceof bitcore.Transaction;
  }), 'All transactions must be instances of bitcore.Transaction');
  return new bitcore.Block({
    header: new bitcore.BlockHeader({
      version: blockData.version,
      prevHash: bitcore.util.buffer.reverse(
        new bitcore.deps.Buffer(blockData.previousblockhash, 'hex')
      ),
      time: blockData.time,
      nonce: blockData.nonce,
      bits: new bitcore.deps.bnjs(
          new bitcore.deps.Buffer(blockData.bits, 'hex')
      ),
      merkleRoot: bitcore.util.buffer.reverse(
        new bitcore.deps.Buffer(blockData.merkleRoot, 'hex')
      )
    }),
    transactions: transactions
  });
};

BlockService.prototype.getBlock = function(blockHash) {
  $.checkArgument(JSUtil.isHexa(blockHash), 'Block hash must be hexa');

  var blockData;
  var self = this;

  return Promise.try(function() {

    return self.rpc.getBlockAsync(blockHash);

  }).then(function(block) {

    blockData = block.result;
    return Promise.all(blockData.tx.map(function(txId) {
      return self.transactionService.getTransaction(txId);
    }));

  }).then(function(transactions) {

    blockData.transactions = transactions;
    return Promise.resolve(BlockService.blockRPCtoBitcore(blockData));

  }).catch(function(err) {
    console.log(err);
    return Promise.reject(err);
  });
};

BlockService.prototype.getBlockByHeight = function(height) {

  $.checkArgument(_.isNumber(height), 'Block height must be a number');
  var self = this;

  return Promise.try(function() {

    return this.rpc.getBlockHash(height);

  }).then(function(blockHash) {

    return self.getBlock(blockHash);

  }).catch(function(err) {
    console.log(err);
    return Promise.reject(err);
  });
};

BlockService.prototype.getLatest = function() {

  var self = this;

  return Promise.try(function() {

    return self.database.getAsync(LATEST_BLOCK);

  }).then(function(blockHash) {

    return self.getBlock(blockHash);

  }).catch(function(err) {
    console.log(err);
    return Promise.reject(err);
  });
};


module.exports = BlockService;
