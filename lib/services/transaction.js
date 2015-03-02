'use strict';

var Sequelize = require('sequelize');
var Promise = require('bluebird');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;

function TransactionService (opts) {
}

TransactionService.prototype.getTransaction = function(schema, transactionId, databaseTransaction) {
  $.checkArgument(_.isString(transactionId), 'Expected transactionId as string');
  return schema.Transaction.find({
    where: { hash: transactionId }
  }, {
    transaction: databaseTransaction
  }).then(function(storedTransaction) {
    return new bitcore.Transaction(storedTransaction.getDataValue('raw').toString());
  });
};

TransactionService.prototype.saveTransaction = function(schema, transaction, databaseTransaction) {
  $.checkArgument(transaction, 'Missing transaction');
  var self = this;
  var execute = function(databaseTransaction) {
    return schema.Transaction.create({
      hash: transaction.hash,
      version: transaction.version,
      nLockTime: transaction.nLockTime,
      raw: transaction.toString()
    }, { transaction: databaseTransaction }
    ).then(function(storedTransaction) {
      return Promise.all(
        _.map(transaction.inputs, function(input, index) {
          return self._saveInput(schema, databaseTransaction, transaction, storedTransaction, index);
        }).concat(
        _.map(transaction.outputs, function(output, index) {
          return self._saveOutput(schema, databaseTransaction, transaction, storedTransaction, index);
        }))
      );
    });
  };
  if (databaseTransaction) {
    return execute(databaseTransaction);
  } else {
    return schema.transaction({
      isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
    }).then(function(databaseTransaction) {
      return execute(databaseTransaction).then(function() {
        databaseTransaction.commit();
      }).catch(function() {
        databaseTransaction.rollback();
      });
    });
  }
};

TransactionService.prototype._saveInput = function(schema, databaseTransaction, transaction, storedTransaction, inputIndex) {
  $.checkArgument(transaction instanceof bitcore.Transaction, 'Expected transaction to be a Transaction');
  var input = transaction.inputs[inputIndex];
  return schema.Input.create({
    inputIndex: inputIndex,
    transaction_id: storedTransaction.id,
    amount: input.output ? input.output.satoshis : undefined,
    prevTxId: input.prevTxId,
    outputIndex: input.outputIndex,
    sequenceNumber: input.sequenceNumber,
    script: input.script.toString()
  }, { transaction: databaseTransaction });
  // TODO: Relate address
};

TransactionService.prototype._saveOutput = function(schema, databaseTransaction, transaction, storedTransaction, outputIndex) {
  $.checkArgument(transaction instanceof bitcore.Transaction, 'Expected transaction to be a Transaction');
  var output = transaction.outputs[outputIndex];
  return schema.Output.create({
    outputIndex: outputIndex,
    transaction_id: storedTransaction.id,
    amount: output.satoshis,
    script: output.script.toString()
  }, { transaction: databaseTransaction });
  // TODO: Relate address
};

/*
 * TODO: _relateAddressTo*
 *

TransactionService.prototype._relateAddressToInput = function(schema, address, storedInput) {
};

TransactionService.prototype._relateAddressToOutput = function(schema, address, storedInput) {
};

TransactionService.prototype._relateAddressToTransaction = function(schema, address, transaction) {
};

 *
 */

module.exports = TransactionService;
