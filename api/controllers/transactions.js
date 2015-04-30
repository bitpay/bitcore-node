'use strict';

var Promise = require('bluebird');

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Transaction = bitcore.Transaction;

var errors = require('../../lib/errors');

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
  node.transactionService.getTransaction(txHash)
    .then(function(tx) {
      req.tx = tx;
    })
    .then(next)
    .catch(errors.Transactions.NotFound, function() {
      res.status(404).send('Transaction with id ' + txHash + ' not found');
    })
    .catch(function() {
      console.log(arguments);
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
    .catch(errors.Transactions.CantBroadcast, function(err) {
      res.status(422).send(err.message);
    });
};



var buildIOHelper = function(name) {
  $.checkArgument(name === 'inputs' || name === 'outputs');
  return function(req, res) {
    $.checkState(req.tx instanceof Transaction);
    if (_.isNumber(req.index)) {
      if (req.index >= req.tx[name].length) {
        res.status(404).send('Transaction ' + name.substring(0, name.length - 1) + ' ' + req.index +
          ' for ' + req.tx.id + ' not found, it only has ' + req.tx[name].length + ' ' + name + '.');
        return;
      }
      res.send(req.tx[name][req.index].toObject());
      return;
    }
    res.send(req.tx[name].map(function(x) {
      return x.toObject();
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
