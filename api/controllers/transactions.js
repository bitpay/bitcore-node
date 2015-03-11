'use strict';

var Promise = require('bluebird');

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Transaction = bitcore.Transaction;

var BitcoreNode = require('../../');

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
  node.getTransaction(txHash)
    .then(function(tx) {
      req.tx = tx;
    })
    .then(next)
    .catch(BitcoreNode.errors.Transactions.NotFound, function() {
      res.status(404).send('Transaction with id ' + txHash + ' not found');
    });
};

/*
 * sets an input or output index
 */
Transactions.indexParam = function(req, res, next, index) {
  index = parseInt(index);
  req.index = index;
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
    .catch(BitcoreNode.errors.Transactions.CantBroadcast, function(err) {
      res.status(422).send(err.message);
    });
};


/*
 * Returns a list of transactions given certain request options
 */
Transactions.list = function(req, res) {
  var opts = {};
  opts.address = req.address;
  node.listTransactions(opts)
    .then(function(transactions) {
      res.send(transactions);
    });
};


var buildIOHelper = function(name) {
  $.checkArgument(name === 'inputs' || name === 'outputs');
  return function(req, res) {
    $.checkState(req.tx instanceof Transaction);
    if (_.isNumber(req.index)) {
      res.send(req.tx[name][req.index].toJSON());
      return;
    }
    res.send(req.tx[name].map(function(x) {
      return x.toJSON();
    }));
  };

};

/**
 * Returns a transaction's outputs
 */
Transactions.getInputs = buildIOHelper('inputs');

/**
 * Returns a transaction's outputs
 */
Transactions.getOutputs = buildIOHelper('outputs');

/**
 * errors
 */

Transaction._sendError = function(res) {
  res.status(422);
  res.send('/v1/transactions/send parameter must be a raw transaction hex');
};


Transactions.getTxError = function(req, res) {
  res.status(422);
  res.send('/v1/transactions/ parameter must be a 64 digit hex');
};

Transactions.indexError = function(req, res) {
  res.status(422);
  res.send('index parameter must be a positive integer');
};

module.exports = Transactions;
