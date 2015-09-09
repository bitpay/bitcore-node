'use strict';

var bitcore = require('bitcore');
var async = require('async');
var _ = bitcore.deps._;

/**
 * This represents an instance that keeps track of data over a series of
 * asynchronous I/O calls to get the transaction history for a group of
 * addresses. History can be queried by start and end block heights to limit large sets
 * of results (uses leveldb key streaming). See AddressService.prototype.getAddressHistory
 * for complete documentation about options.
 */
function AddressHistory(args) {
  this.node = args.node;
  this.options = args.options;

  if(Array.isArray(args.addresses)) {
    this.addresses = args.addresses;
  } else {
    this.addresses = [args.addresses];
  }
  this.transactionInfo = [];
  this.transactions = {};
  this.sortedArray = [];
}

AddressHistory.MAX_ADDRESS_QUERIES = 20;
AddressHistory.MAX_TX_QUERIES = 10;

AddressHistory.prototype.get = function(callback) {
  var self = this;

  // TODO check for mempool inputs and outputs by a group of addresses, currently
  // each address individually loops through the mempool and does not check input scripts.

  async.eachLimit(
    self.addresses,
    AddressHistory.MAX_ADDRESS_QUERIES,
    function(address, next) {
      self.getTransactionInfo(address, next);
    },
    function(err) {
      if (err) {
        return callback(err);
      }

      async.eachSeries(
        self.transactionInfo,
        function(txInfo, next) {
          self.getDetailedInfo(txInfo, next);
        },
        function(err) {
          if (err) {
            return callback(err);
          }
          self.sortTransactionsIntoArray();
          self.paginateSortedArray();
          callback(null, self.sortedArray);
        }
      );
    }
  );
};

AddressHistory.prototype.getTransactionInfo = function(address, next) {
  var self = this;

  var args = {
    start: self.options.start,
    end: self.options.end,
    queryMempool: _.isUndefined(self.options.queryMempool) ? true : self.options.queryMempool
  };

  var outputs;
  var inputs;

  async.parallel([
    function(done) {
      self.node.services.address.getOutputs(address, args, function(err, result) {
        if (err) {
          return done(err);
        }
        outputs = result;
        done();
      });
    },
    function(done) {
      self.node.services.address.getInputs(address, args, function(err, result) {
        if (err) {
          return done(err);
        }
        inputs = result;
        done();
      });
    }
  ], function(err) {
    if (err) {
      return next(err);
    }
    self.transactionInfo = self.transactionInfo.concat(outputs, inputs);
    next();
  });
};

AddressHistory.sortByHeight = function(a, b) {
  // TODO consider timestamp for mempool transactions
  return a.height < b.height;
};

AddressHistory.prototype.paginateSortedArray = function() {
  if (!_.isUndefined(this.options.from) && !_.isUndefined(this.options.to)) {
    this.sortedArray = this.sortedArray.slice(this.options.from, this.options.to);
  }
};

AddressHistory.prototype.getDetailedInfo = function(txInfo, next) {
  var self = this;
  var queryMempool = _.isUndefined(self.options.queryMempool) ? true : self.options.queryMempool;

  if (self.transactions[txInfo.address] && self.transactions[txInfo.address][txInfo.txid]) {
    self.amendDetailedInfoWithSatoshis(txInfo);
    setImmediate(next);
  } else {
    self.node.services.db.getTransactionWithBlockInfo(
      txInfo.txid,
      queryMempool,
      function(err, transaction) {
        if (err) {
          return next(err);
        }

        transaction.populateInputs(self.node.services.db, [], function(err) {
          if(err) {
            return next(err);
          }
          var confirmations = 0;
          if (transaction.__height >= 0) {
            confirmations = self.node.services.db.tip.__height - transaction.__height + 1;
          }

          if (!self.transactions[txInfo.address]) {
            self.transactions[txInfo.address] = {};
          }

          self.transactions[txInfo.address][txInfo.txid] = {
            address: txInfo.address,
            satoshis: 0,
            height: transaction.__height,
            confirmations: confirmations,
            timestamp: transaction.__timestamp,
            // TODO bitcore should return null instead of throwing error on coinbase
            fees: !transaction.isCoinbase() ? transaction.getFee() : null,
            outputIndexes: [],
            inputIndexes: [],
            tx: transaction
          };

          self.amendDetailedInfoWithSatoshis(txInfo);
          next();
        });
      }
    );
  }
};

AddressHistory.prototype.amendDetailedInfoWithSatoshis = function(txInfo) {
  var historyItem = this.transactions[txInfo.address][txInfo.txid];
  if (txInfo.outputIndex >= 0) {
    historyItem.outputIndexes.push(txInfo.outputIndex);
    historyItem.satoshis += txInfo.satoshis;
  } else if (txInfo.inputIndex >= 0){
    historyItem.inputIndexes.push(txInfo.inputIndex);
    historyItem.satoshis -= historyItem.tx.inputs[txInfo.inputIndex].output.satoshis;
  }
};

AddressHistory.prototype.sortTransactionsIntoArray = function() {
  this.sortedArray = [];
  for(var address in this.transactions) {
    for(var txid in this.transactions[address]) {
      this.sortedArray.push(this.transactions[address][txid]);
    }
  }
  this.sortedArray.sort(AddressHistory.sortByHeight);
};

module.exports = AddressHistory;
