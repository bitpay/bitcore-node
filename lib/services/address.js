'use strict';

var Promise = require('bluebird');
var bitcore = require('bitcore');
var _ = bitcore.deps._;

var NULLTXHASH = bitcore.util.buffer.emptyBuffer(32).toString('hex');
var LASTTXHASH = bitcore.util.buffer.fill(bitcore.util.buffer.emptyBuffer(32), -1).toString('hex');
var MAXOUTPUT = 1 << 31;

function AddressService(opts) {
  opts = _.extend({}, opts);
  this.transactionService = opts.transactionService;
  this.blockService = opts.blockService;
  this.database = opts.database || Promise.promisifyAll(new LevelUp(config.get('LevelUp')));
  this.rpc = opts.rpc || Promise.promisifyAll(new RPC(config.get('RPC')));
}

AddressService.prototype.getSummary = function(address, confirmations) {

  var self = this;
  var tip, allOutputs, spent;
  confirmations = confirmations || 6;

  return Promise.try(function() {

    return self.blockService.getLatest();

  }).then(function(latest) {

    tip = latest;
    return self.getAllOutputs(address);

  }).then(function(outputs) {

    allOutputs = outputs;
    return self.getSpent(address);

  }).then(function(spent) {

    return self.buildAddressSummary(address, tip, allOutputs, spent);

  });
};

AddressService.prototype.getAllOutputs = function(address) {
  var results = [];
  var self = this;

  return new Promise(function(resolve, reject) {
    self.db.createReadStream({
      gte: TransactionService.Index.getOutputsForAddress(address, NULLTXHASH, 0),
      lte: TransactionService.Index.getOutputsForAddress(address, LASTTXHASH, MAXOUTPUT)
    }).on('data', function(element) {
      results.push(element.value);
    }).on('close', function() {
      reject();
    }).on('end', function() {
      resolve(results);
    });
  });
};

AddressService.prototype.getSpent = function(address) {
  var results = [];
  var self = this;

  return new Promise(function(resolve, reject) {
    self.db.createReadStream({
      gte: TransactionService.Index.getSpentOutputsForAddress(address, NULLTXHASH, 0),
      lte: TransactionService.Index.getSpentOutputsForAddress(address, LASTTXHASH, MAXOUTPUT)
    }).on('data', function(element) {
      results.push(element.value);
    }).on('close', function() {
      reject();
    }).on('end', function() {
      resolve(results);
    });
  });
};

AddressService.prototype.buildAddressSummary = function(address, tip, allOutputs, spent) {

  var result = {};
  var transactionsAppended = {};

  result.address = address.toString();
  result.transactions = [];

  result.confirmed = {
    balance: 0,
    sent: 0,
    received: 0
  };
  result.unconfirmed = {
    balance: 0,
    sent: 0,
    received: 0
  };
  _.each(allOutputs, function(output) {
    var value = output.satoshis;
    result.unconfirmed.balance += value;
    result.unconfirmed.received += value;
    if (tip.height - output.heightConfirmed - 1 >= confirmations) {
      result.confirmed.balance += value;
      result.confirmed.received += value;
    }
  });
  _.each(spent, function(output) {
    var value = output.satoshis;
    if (!transactionsAppended[output.spentTx]) {
      transactionsAppended[output.spentTx] = true;
      result.transactions.push(output.spentTx);
    }
    if (!transactionsAppended[output.spendInput.prevTxId]) {
      transactionsAppended[output.spendInput.prevTxId] = true;
      result.transactions.push(output.spendInput.prevTxId);
    }
    result.unconfirmed.balance -= value;
    result.unconfirmed.sent += value;
    if (tip.height - output.heightSpent - 1 >= confirmations) {
      result.confirmed.balance -= value;
      result.confirmed.sent += value;
    }
  });

  return result;
};

module.exports = AddressService;
