/**
 * @file service/transaction.js
 *
 * This implementation stores a set of indexes so quick queries are possible.
 * An "index" for the purposes of this explanation is a structure for a set
 * of keys to the LevelDB key/value store so that both the key and values can be
 * sequentially accesed, which is a fast operation on LevelDB.
 *
 * Map of transaction to related addresses:
 * * address-<address>-<ts>-<transaction>-<outputIndex> -> true (unspent)
 *                                                      -> <spendTxId:inputIndex>
 * * output-<transaction>-<outputIndex> -> { script, amount, spendTxId, spendIndex }
 * * input-<transaction>-<inputIndex> -> { script, amount, prevTxId, outputIndex, output }
 *
 */
'use strict';

var RPC = require('bitcoind-rpc');
var LevelUp = require('levelup');
var Promise = require('bluebird');
var bitcore = require('bitcore');
var config = require('config');

var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;

function TransactionService (opts) {
  opts = _.extend({}, opts);
  this.database = opts.database || Promise.promisifyAll(new LevelUp(config.get('LevelUp')));
  this.rpc = opts.rpc || Promise.promisifyAll(new RPC(config.get('RPC')));
}

TransactionService.transactionRPCtoBitcore = function(rpcResponse) {
  if (rpcResponse.error) {
    throw new bitcore.Error(rpcResponse.error);
  }
  return new bitcore.Transaction(rpcResponse.result);
};

TransactionService.prototype.getTransaction = function(transactionId) {

  var self = this;

  return Promise.try(function() {
    return self.rpc.getRawTransactionAsync(transactionId);
  }).then(function(rawTransaction) {
    return TransactionService.transactionRPCtoBitcore(rawTransaction);
  });
};

module.exports = TransactionService;
