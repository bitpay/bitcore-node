'use strict';

var TransactionService = require('./transaction');
var Sequelize = require('sequelize');
var _ = require('bitcore').deps._;
var Promise = require('bluebird');

function BlockService (opts) {
  opts = _.extend({}, opts);
  this.transactionService = opts.transactionService || new TransactionService();
}

BlockService.prototype.saveBlock = function(schema, block, databaseTransaction) {

  var self = this;
  var execute = function(dbTx) {
    return schema.Block.create({
      hash: block.hash,
      version: block.header.version,
      height: block.header.height,
      time: block.header.time,
      nonce: block.header.nonce,
      merkleRoot: block.header.merkleRoot,
      parent: block.header.prevHash.toString('hex')
    }, { transaction: dbTx }
    ).then(function(storedBlock) {
      return Promise.all(
        _.map(block.transactions, function(transaction) {
          return self.transactionService.saveTransaction(schema, transaction, dbTx);
        })
      );
    });
  };
  if (databaseTransaction) {
    return databaseTransaction.then(execute);
  } else {
    return schema.transaction({
      isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
    }).then(function(databaseTransaction) {
      return execute(databaseTransaction).then(function() {
        databaseTransaction.commit();
      }).catch(function(err) {
        console.log(err.stack);
        databaseTransaction.rollback();
      });
    });
  }
};

module.exports = BlockService;
