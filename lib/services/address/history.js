'use strict';

var bitcore = require('bitcore-lib');
var async = require('async');
var _ = bitcore.deps._;

var constants = require('./constants');

/**
 * This represents an instance that keeps track of data over a series of
 * asynchronous I/O calls to get the transaction history for a group of
 * addresses. History can be queried by start and end block heights to limit large sets
 * of results (uses leveldb key streaming).
 */
function AddressHistory(args) {
  this.node = args.node;
  this.options = args.options;

  if(Array.isArray(args.addresses)) {
    this.addresses = args.addresses;
  } else {
    this.addresses = [args.addresses];
  }

  this.maxHistoryQueryLength = constants.MAX_HISTORY_QUERY_LENGTH;

  this.addressStrings = [];
  for (var i = 0; i < this.addresses.length; i++) {
    var address = this.addresses[i];
    if (address instanceof bitcore.Address) {
      this.addressStrings.push(address.toString());
    } else if (_.isString(address)) {
      this.addressStrings.push(address);
    } else {
      throw new TypeError('Addresses are expected to be strings');
    }
  }

  this.detailedArray = [];
}

AddressHistory.MAX_ADDRESS_QUERIES = 20;

/**
 * This function will give detailed history for the configured
 * addresses. See AddressService.prototype.getAddressHistory
 * for complete documentation about options and response format.
 */
AddressHistory.prototype.get = function(callback) {
  var self = this;
  var totalCount;

  // TODO: handle multiple addresses (restore previous functionality)
  if (self.addresses.length > 1) {
    return callback('Only single address queries supported currently');
  }

  var address = self.addresses[0];

  this.node.services.address.getAddressSummary(address, this.options, function(err, summary) {
    if (err) {
      return callback(err);
    }

    totalCount = summary.txids.length;

    // TODO: Make sure txids are sorted by height and time
    var fromOffset = summary.txids.length - self.options.from;
    var toOffset = summary.txids.length - self.options.to;
    var txids = summary.txids.slice(toOffset, fromOffset);

    // Verify that this query isn't too long
    if (txids.length > self.maxHistoryQueryLength) {
      return callback(new Error(
        'Maximum length query (' + self.maxAddressQueryLength + ') exceeded for addresses:' +
          this.address.join(',')
      ));
    }

    // Reverse to include most recent at the top
    txids.reverse();

    async.eachSeries(
      txids,
      function(txid, next) {
        self.getDetailedInfo(txid, next);
      },
      function(err) {
        if (err) {
          return callback(err);
        }
        callback(null, {
          totalCount: totalCount,
          items: self.detailedArray
        });
      }
    );

  });

};

/**
 * A helper function to sort and slice/paginate the `combinedArray`
 */
// TODO: Remove once txids summary results are verified to be sorted
AddressHistory.prototype.sortAndPaginateCombinedArray = function() {
  this.combinedArray.sort(AddressHistory.sortByHeight);
  if (!_.isUndefined(this.options.from) && !_.isUndefined(this.options.to)) {
    this.combinedArray = this.combinedArray.slice(this.options.from, this.options.to);
  }
};

/**
 * A helper sort function to order by height and then by date
 * for transactions that are in the mempool.
 * @param {Object} a - An item from the `combinedArray`
 * @param {Object} b
 */
// TODO: Remove once txids summary results are verified to be sorted
AddressHistory.sortByHeight = function(a, b) {
  if (a.height < 0 && b.height < 0) {
    // Both are from the mempool, compare timestamps
    if (a.timestamp === b.timestamp) {
      return 0;
    } else {
      return a.timestamp < b.timestamp ? 1 : -1;
    }
  } else if (a.height < 0 && b.height > 0) {
    // A is from the mempool and B is in a block
    return -1;
  } else if (a.height > 0 && b.height < 0) {
    // A is in a block and B is in the mempool
    return 1;
  } else if (a.height === b.height) {
    // The heights are equal
    return 0;
  } else {
    // Otherwise compare heights
    return a.height < b.height ? 1 : -1;
  }
};

/**
 * This function will transform items from the combinedArray into
 * the detailedArray with the full transaction, satoshis and confirmation.
 * @param {Object} txInfo - An item from the `combinedArray`
 * @param {Function} next
 */
AddressHistory.prototype.getDetailedInfo = function(txid, next) {
  var self = this;
  var queryMempool = _.isUndefined(self.options.queryMempool) ? true : self.options.queryMempool;

  self.node.services.db.getTransactionWithBlockInfo(
    txid,
    queryMempool,
    function(err, transaction) {
      if (err) {
        return next(err);
      }

      transaction.populateInputs(self.node.services.db, [], function(err) {
        if (err) {
          return next(err);
        }

        var addressDetails = self.getAddressDetailsForTransaction(transaction);

        self.detailedArray.push({
          addresses: addressDetails.addresses,
          satoshis: addressDetails.satoshis,
          height: transaction.__height,
          confirmations: self.getConfirmationsDetail(transaction),
          timestamp: transaction.__timestamp,
          // TODO bitcore-lib should return null instead of throwing error on coinbase
          fees: !transaction.isCoinbase() ? transaction.getFee() : null,
          tx: transaction
        });

        next();
      });
    }
  );
};

/**
 * A helper function for `getDetailedInfo` for getting the confirmations.
 * @param {Transaction} transaction - A transaction with a populated __height value.
 */
AddressHistory.prototype.getConfirmationsDetail = function(transaction) {
  var confirmations = 0;
  if (transaction.__height >= 0) {
    confirmations = this.node.services.db.tip.__height - transaction.__height + 1;
  }
  return confirmations;
};

AddressHistory.prototype.getAddressDetailsForTransaction = function(transaction) {
  var result = {
    addresses: {},
    satoshis: 0
  };

  for (var inputIndex = 0; inputIndex < transaction.inputs.length; inputIndex++) {
    var input = transaction.inputs[inputIndex];
    if (!input.script) {
      continue;
    }
    var inputAddress = input.script.toAddress(this.node.network);
    if (inputAddress && this.addressStrings.indexOf(inputAddress.toString()) > 0) {
      if (!result.addresses[inputAddress]) {
        result.addresses[inputAddress] = {
          inputIndexes: [],
          outputIndexes: []
        };
      } else {
        result.addresses[inputAddress].inputIndexes.push(inputIndex);
      }
      result.satoshis -= input.output.satoshis;
    }
  }

  for (var outputIndex = 0; outputIndex < transaction.outputs.length; outputIndex++) {
    var output = transaction.outputs[outputIndex];
    if (!output.script) {
      continue;
    }
    var outputAddress = output.script.toAddress(this.node.network);
    if (outputAddress && this.addressStrings.indexOf(outputAddress.toString()) > 0) {
      if (!result.addresses[outputAddress]) {
        result.addresses[outputAddress] = {
          inputIndexes: [],
          outputIndexes: []
        };
      } else {
        result.addresses[outputAddress].inputIndexes.push(outputIndex);
      }
      result.satoshis += output.satoshis;
    }
  }

  return result;

};

module.exports = AddressHistory;
