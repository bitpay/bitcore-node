'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Transaction = bitcore.Transaction;

var mockTransactions = require('../test/data/transactions');

var Transactions = {};

var node;
Transactions.setNode = function(aNode) {
  node = aNode;
};


/*
 *  params
 */

/*
 * Finds a transaction by its hash
 */
Transactions.txHashParam = function(req, res, next, txHash) {
  // TODO: fetch tx from service
  var tx = mockTransactions[txHash];

  if (_.isUndefined(tx)) {
    res.status(404).send('Transaction with id ' + txHash + ' not found');
    return;
  }
  req.tx = tx;
  next();
};


/*
 * controllers
 */

Transactions.get = function(req, res) {
  $.checkState(req.tx instanceof Transaction);
  res.send(req.tx.toObject());
};
Transactions.getTxError = function(req, res) {
  res.status(422);
  res.send('/v1/transactions/ parameter must be a 64 digit hex');
};

module.exports = Transactions;
