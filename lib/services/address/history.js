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
  this.combinedArray = [];
  this.detailedArray = [];
}

AddressHistory.MAX_ADDRESS_QUERIES = 20;

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

      self.combineTransactionInfo();
      self.sortAndPaginateCombinedArray();

      async.eachSeries(
        self.combinedArray,
        function(txInfo, next) {
          self.getDetailedInfo(txInfo, next);
        },
        function(err) {
          if (err) {
            return callback(err);
          }
          callback(null, self.detailedArray);
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

/**
 * This function combines results from getInputs and getOutputs by
 * combining inputIndexes and outputIndexes for address transaction
 * matching combinations.
 */
AddressHistory.prototype.combineTransactionInfo = function() {
  var combinedArrayMap = {};
  this.combinedArray = [];
  var l = this.transactionInfo.length;
  for(var i = 0; i < l; i++) {
    var item = this.transactionInfo[i];
    var mapKey = item.address + item.txid;
    if (combinedArrayMap[mapKey] >= 0) {
      var combined = this.combinedArray[combinedArrayMap[mapKey]];
      if (item.outputIndex >= 0) {
        combined.satoshis += item.satoshis;
        combined.outputIndexes.push(item.outputIndex);
      } else if (item.inputIndex >= 0) {
        combined.inputIndexes.push(item.inputIndex);
      }
    } else {
      item.outputIndexes = [];
      item.inputIndexes = [];
      if (item.outputIndex >= 0) {
        item.outputIndexes.push(item.outputIndex);
        delete item.outputIndex;
      } else if (item.inputIndex >= 0) {
        item.inputIndexes.push(item.inputIndex);
        delete item.inputIndex;
      }
      this.combinedArray.push(item);
      combinedArrayMap[mapKey] = this.combinedArray.length - 1;
    }
  }
};

AddressHistory.prototype.sortAndPaginateCombinedArray = function() {
  this.combinedArray.sort(AddressHistory.sortByHeight);
  if (!_.isUndefined(this.options.from) && !_.isUndefined(this.options.to)) {
    this.combinedArray = this.combinedArray.slice(this.options.from, this.options.to);
  }
};

AddressHistory.sortByHeight = function(a, b) {
  // TODO consider timestamp for mempool transactions
  return a.height < b.height;
};

AddressHistory.prototype.getDetailedInfo = function(txInfo, next) {
  var self = this;
  var queryMempool = _.isUndefined(self.options.queryMempool) ? true : self.options.queryMempool;

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

        self.detailedArray.push({
          address: txInfo.address,
          satoshis: self.getSatoshisDetail(transaction, txInfo),
          height: transaction.__height,
          confirmations: self.getConfirmationsDetail(transaction),
          timestamp: transaction.__timestamp,
          // TODO bitcore should return null instead of throwing error on coinbase
          fees: !transaction.isCoinbase() ? transaction.getFee() : null,
          outputIndexes: txInfo.outputIndexes,
          inputIndexes: txInfo.inputIndexes,
          tx: transaction
        });

        next();
      });
    }
  );
};

AddressHistory.prototype.getConfirmationsDetail = function(transaction) {
  var confirmations = 0;
  if (transaction.__height >= 0) {
    confirmations = this.node.services.db.tip.__height - transaction.__height + 1;
  }
  return confirmations;
};

AddressHistory.prototype.getSatoshisDetail = function(transaction, txInfo) {
  var satoshis = txInfo.satoshis || 0;

  if (txInfo.inputIndexes.length >= 0) {
    for(var j = 0; j < txInfo.inputIndexes.length; j++) {
      satoshis -= transaction.inputs[txInfo.inputIndexes[j]].output.satoshis;
    }
  }
  return satoshis;
};

module.exports = AddressHistory;
