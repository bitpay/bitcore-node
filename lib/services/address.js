'use strict';

var Promise = require('bluebird');
var bitcore = require('bitcore');
var TransactionService = require('./transaction');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;

var NULLTXHASH = bitcore.util.buffer.emptyBuffer(32).toString('hex');
var LASTTXHASH = bitcore.util.buffer.fill(bitcore.util.buffer.emptyBuffer(32), -1).toString('hex');
var MAXOUTPUT = 4294967295;

function AddressService(opts) {
  opts = _.extend({}, opts);
  this.transactionService = opts.transactionService;
  this.blockService = opts.blockService;
  this.database = opts.database;
  this.rpc = opts.rpc;
}

AddressService.prototype.getSummary = function(address, confirmations) {

  var self = this;
  var tip, allOutputs, spent;

  return Promise.try(function() {

    return self.blockService.getLatest();

  }).then(function(latest) {

    tip = latest;
    return self.getAllOutputs(address);

  }).then(function(outputs) {

    allOutputs = outputs;
    return self.getSpent(address);

  }).then(function(spent) {

    return self.buildAddressSummary(address, tip, allOutputs, spent, confirmations);

  });
};

AddressService.processOutput = function(data) {
  var elements = data.key.split('-');
  var output = _.extend(JSON.parse(data.value), {
    address: elements[1],
    txId: elements[2],
    outputIndex: elements[3]
  });
  return output;
};

var retrieveOutputs = function(indexFunction, processElement) {
  return function(address) {
    $.checkArgument(address, 'address required');
    var results = [];
    var self = this;

    return new Promise(function(resolve, reject) {
      self.database.createReadStream({
        gte: indexFunction(address, NULLTXHASH, 0),
        lte: indexFunction(address, LASTTXHASH, MAXOUTPUT)
      }).on('data', function(element) {
        results.push(processElement(element));
      }).on('error', reject).on('end', function() {
        return resolve(results);
      });
    });
  };
};

AddressService.prototype.getAllOutputs = retrieveOutputs(
  TransactionService.Index.getOutputsForAddress,
  function(e) {
    return AddressService.processOutput(e);
  }
);

AddressService.prototype.getSpent = retrieveOutputs(
  TransactionService.Index.getSpentOutputsForAddress,
  function(e) {
    return AddressService.processOutput(e);
  }
);


AddressService.prototype.getUnspent = function(addrs) {

  $.checkArgument(addrs, 'addresses required');
  $.checkArgument(_.isArray(addrs), 'addresses is array required');
  
  var self = this;
  return Promise.all(addrs.map(function(addr) {
    return self.getUnspentForAddress(addr);
  }))
  .then(function(results) {
    return _.flatten(results);
  });

  
};
AddressService.prototype.getUnspentForAddress = function(addr) {
  $.checkArgument(addr, 'address required');
  var all, spent;
  var self = this;
  return this.getAllOutputs(addr)
    .then(function(s) {
      all = s;
      return self.getSpent(addr);
    })
    .then(function(s) {
      spent = s;
      return _.filter(all, function(out) {
        return !_.contains(spent, out);
      });
    });
};

AddressService.prototype.buildAddressSummary = function(address, tip, allOutputs, spent, confirmations) {

  var result = {};
  var transactionsAppended = {};
  confirmations = confirmations || 6;

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

  var outputValues = {};

  _.each(allOutputs, function(output) {
    var value = output.satoshis;
    outputValues[output.txId + '-' + output.outputIndex] = value;
    result.unconfirmed.balance += value;
    result.unconfirmed.received += value;
    if (tip.height - output.heightConfirmed + 1 >= confirmations) {
      result.confirmed.balance += value;
      result.confirmed.received += value;
    }
    if (!transactionsAppended[output.txId]) {
      transactionsAppended[output.txId] = true;
      result.transactions.push(output.txId);
    }
  });
  _.each(spent, function(output) {
    var value = outputValues[output.spendInput.prevTxId + '-' + output.spendInput.outputIndex];

    if (!transactionsAppended[output.spentTx]) {
      transactionsAppended[output.spentTx] = true;
      result.transactions.push(output.spentTx);
    }
    result.unconfirmed.balance -= value;
    result.unconfirmed.sent += value;
    if (tip.height - output.heightSpent + 1 >= confirmations) {
      result.confirmed.balance -= value;
      result.confirmed.sent += value;
    }
  });

  return result;
};

module.exports = AddressService;
