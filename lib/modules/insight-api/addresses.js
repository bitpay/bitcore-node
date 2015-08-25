'use strict';

var common = require('./common');

function AddressController(db) {
  this.db = db;
}

AddressController.prototype.show = function(req, res, next, address) {
  var self = this;

  this.db.getAddressHistory(address, true, function(err, txinfos) {
    if(err) {
      return common.handleErrors(err, res);
    }

    res.jsonp(self.transformAddressHistory(txinfos));
  });
};

AddressController.prototype.transformAddressHistory = function(txinfos) {
  var transactions = txinfos.map(txinfos, function(info) {
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

AddressController.prototype.getAddr = function(req, res, next) {
  var a;
  try {
    var addr = req.param('addr');
    a = new Address(addr);
  } catch (e) {
    common.handleErrors({
      message: 'Invalid address:' + e.message,
      code: 1
    }, res, next);
    return null;
  }
  return a;
};

module.exports = AddressController;