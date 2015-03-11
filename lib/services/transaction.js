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

var NULLTXHASH = bitcore.util.buffer.emptyBuffer(32).toString('hex');

var helper = function(name) {
  return function(txId, output) {
    if (txId instanceof bitcore.Transaction) {
      txId = txId.hash;
    }
    $.checkArgument(_.isString(txId), 'txId must be a string');
    $.checkArgument(_.isNumber(output), 'output must be a number');
    return name + txId + '-' + output;
  };
};
var helperAddress = function(index) {
  return function(address) {
    if (_.isString(address)) {
      address = new bitcore.Address(address);
    }
    $.checkArgument(address instanceof bitcore.Address, 'address must be a string or bitcore.Address');
    return index + address.toString();
  };
};

var Index = {
  output: 'txo-',        // txo-<txid>-<n> -> serialized Output
  spent: 'txs-',         // txo-<txid>-<n>-<spend txid>-<m> -> block height of confirmation for spend
  address: 'txa-',       // txa-<address>-<txid>-<n> -> Output
  addressSpent: 'txas-', // txa-<address>-<txid>-<n> -> {
                         //   heightSpent: number,          (may be -1 for unconfirmed tx)
                         //   spentTx: string, spentTxInputIndex: number, spendInput: Input
                         // }
  transaction: 'btx-'   // btx-<txid> -> block in main chain that confirmed the tx
}

_.extend(Index, {
  getOutput: helper(Index.output),
  getSpentHeight: helper(Index.spent),
  getOutputsForAddress: helperAddress(Index.address),
  getSpentOutputsForAddress: helperAddress(Index.addressSpent),
  getBlockForTransaction: function(transaction) {
    if (_.isString(transaction)) {
      return Index.transaction + transaction;
    } else if (transaction instanceof bitcore.Transaction) {
      return Index.transaction + transaction.id;
    } else {
      throw new bitcore.errors.InvalidArgument(transaction + ' is not a transaction');
    }
  }
});

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

TransactionService.prototype._confirmOutput = function(ops, block, transaction) {
  return function(output, index) {
    ops.push({
      type: 'put',
      key: Index.getOutput(transaction.id, index),
      value: output.toObject()
    });
    var address;
    // TODO: Move this logic to bitcore
    if (output.script.isPublicKeyOut()) {
      var hash = bitcore.crypto.Hash.sha256ripemd160(output.script.chunks[0].buf);
      address = new bitcore.Address(hash, bitcore.Networks.defaultNetwork, bitcore.Address.PayToPublicKeyHash);
    } else if (output.script.isPublicKeyHashOut() || output.script.isScriptHashOut()) {
      address = output.script.toAddress();
    }
    if (address) {
      ops.push({
        type: 'put',
        key: Index.getOutputsForAddress(address),
        value: output.toObject()
      });
    }
  };
};

TransactionService.prototype._confirmInput = function(ops, block, transaction) {
  return function(input, index) {
    if (input.prevTxId.toString('hex') !== NULLTXHASH) {
      ops.push({
        type: 'put',
        key: Index.getOutput(transaction.id, index),
        value: _.extend(input.toObject(), {
          heightConfirmed: block.height
        })
      });
      var script = input.script;
      if (script.isPublicKeyHashIn() || script.isScriptHashIn()) {
        // TODO: Move this logic to bitcore
        var address = script.isPublicKeyHashIn()
          ? new PublicKey(script.chunks[0].buf).toAddress()
          : new Script(script.chunks[script.chunks.length - 1]).toAddress();
        ops.push({
          type: 'put',
          key: Index.getOutputsForAddress(address),
          value: input.toObject()
        });
        ops.push({
          type: 'put',
          key: Index.getSpentOutputsForAddress(address),
          value: {
            heightSpent: block.height,
            spentTx: transaction.id,
            spentTxInputIndex: index,
            spendInput: input.toObject()
          }
        });
      }
    }
  };
};

TransactionService.prototype._confirmTransaction = function(ops, block, transaction) {
  var self = this;
  return Promise.try(function() {
    ops.push({
      type: 'put',
      key: Index.getBlockForTransaction(transaction),
      value: block.id
    });
    _.each(transaction.outputs, self._confirmOutput(ops, block, transaction));
    _.each(transaction.inputs, self._confirmInput(ops, block, transaction));
  });
};

module.exports = TransactionService;
