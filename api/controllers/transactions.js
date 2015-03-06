'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Transaction = bitcore.Transaction;

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
  var tx = node.getTransaction(txHash);

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

/*
 * get transaction by its hash
 */
Transactions.get = function(req, res) {
  $.checkState(req.tx instanceof Transaction);
  res.send(req.tx.toObject());
};


/**
 * send a transaction to the bitcoin network
 */
Transactions.send = function(req, res) {
  var raw = req.body.raw;
  if (_.isUndefined(raw)) {
    Transaction._sendError(res);
    return;
  }
  var tx;
  try {
    tx = new Transaction(raw);
  } catch (e) {
    Transaction._sendError(res);
    return;
  }
  node.broadcast(tx)
    .then(function() {
      res.send('Transaction broadcasted successfully');
    })
    .catch(function(err) {
      res.status(422).send(err);
    });
};

Transaction._sendError = function(res) {
  res.status(422);
  res.send('/v1/transactions/send parameter must be a raw transaction hex');
};


Transactions.getTxError = function(req, res) {
  res.status(422);
  res.send('/v1/transactions/ parameter must be a 64 digit hex');
};

module.exports = Transactions;
