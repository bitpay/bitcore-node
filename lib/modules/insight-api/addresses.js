'use strict';

var common = require('./common');

function AddressController(node) {
  this.node = node;
}

AddressController.prototype.show = function(req, res, next, address) {
  var self = this;

  this.node.getAddressHistory(address, true, function(err, txinfos) {
    if(err) {
      return common.handleErrors(err, res);
    }

    res.jsonp(self.transformAddressHistory(txinfos, address));
  });
};

AddressController.prototype.transformAddressHistory = function(txinfos, address) {
  var transactions = txinfos.map(function(info) {
    return info.tx.hash;
  }).filter(function(value, index, self) {
    return self.indexOf(value) === index;
  });

  var balance = 0;
  var appearances = 0;
  var totalReceived = 0;
  var totalSent = 0;
  var unconfirmedBalance = 0;
  var unconfirmedAppearances = 0;

  for(var i = 0; i < txinfos.length; i++) {
    if(txinfos[i].satoshis > 0) {
      totalReceived += txinfos[i].satoshis;
    } else {
      totalSent += -txinfos[i].satoshis;
    }

    if(txinfos[i].confirmations) {
      balance += txinfos[i].satoshis;
      unconfirmedBalance += txinfos[i].satoshis;
      appearances++;
    } else {
      unconfirmedBalance += txinfos[i].satoshis;
      unconfirmedAppearances++;
    }
  }

  return {
    addrStr: address,
    balance: balance / 1e8,
    balanceSat: balance,
    totalReceived: totalReceived / 1e8,
    totalReceivedSat: totalReceived,
    totalSent: totalSent / 1e8,
    totalSentSat: totalSent,
    unconfirmedBalance: unconfirmedBalance / 1e8,
    unconfirmedBalanceSat: unconfirmedBalance,
    unconfirmedTxApperances: unconfirmedAppearances, // misspelling - ew
    txApperances: appearances, // yuck
    transactions: transactions
  };
};

module.exports = AddressController;