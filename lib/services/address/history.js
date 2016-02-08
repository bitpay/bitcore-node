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

  this.maxHistoryQueryLength = args.options.maxHistoryQueryLength || constants.MAX_HISTORY_QUERY_LENGTH;
  this.maxAddressesQuery = args.options.maxAddressesQuery || constants.MAX_ADDRESSES_QUERY;
  this.maxAddressesLimit = args.options.maxAddressesLimit || constants.MAX_ADDRESSES_LIMIT;

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

AddressHistory.prototype._mergeAndSortTxids = function(summaries) {
  var appearanceIds = {};
  var unconfirmedAppearanceIds = {};

  for (var i = 0; i < summaries.length; i++) {
    var summary = summaries[i];
    for (var key in summary.appearanceIds) {
      appearanceIds[key] = summary.appearanceIds[key];
      delete summary.appearanceIds[key];
    }
    for (var unconfirmedKey in summary.unconfirmedAppearanceIds) {
      unconfirmedAppearanceIds[unconfirmedKey] = summary.unconfirmedAppearanceIds[unconfirmedKey];
      delete summary.unconfirmedAppearanceIds[key];
    }
  }
  var confirmedTxids = Object.keys(appearanceIds);
  confirmedTxids.sort(function(a, b) {
    // Confirmed are sorted by height
    return appearanceIds[a] - appearanceIds[b];
  });
  var unconfirmedTxids = Object.keys(unconfirmedAppearanceIds);
  unconfirmedTxids.sort(function(a, b) {
    // Unconfirmed are sorted by timestamp
    return unconfirmedAppearanceIds[a] - unconfirmedAppearanceIds[b];
  });
  return confirmedTxids.concat(unconfirmedTxids);
};

/**
 * This function will give detailed history for the configured
 * addresses. See AddressService.prototype.getAddressHistory
 * for complete documentation about options and response format.
 */
AddressHistory.prototype.get = function(callback) {
  var self = this;
  if (this.addresses.length > this.maxAddressesQuery) {
    return callback(new TypeError('Maximum number of addresses (' + this.maxAddressesQuery + ') exceeded'));
  }

  this.options.noBalance = true;

  if (this.addresses.length === 1) {
    var address = this.addresses[0];
    self.node.services.address.getAddressSummary(address, this.options, function(err, summary) {
      if (err) {
        return callback(err);
      }
      return self._paginateWithDetails.call(self, summary.txids, callback);
    });
  } else {
    var opts = _.clone(this.options);

    opts.fullTxList = true;
    async.mapLimit(
      self.addresses,
      self.maxaddressesLimit,
      function(address, next) {
        self.node.services.address.getAddressSummary(address, opts, next);
      },
      function(err, summaries) {
        if (err) {
          return callback(err);
        }
        var txids = self._mergeAndSortTxids(summaries);
        return self._paginateWithDetails.call(self, txids, callback);
      }
    );
  }

};

AddressHistory.prototype._paginateWithDetails = function(allTxids, callback) {
  var self = this;
  var totalCount = allTxids.length;

  // Slice the page starting with the most recent
  var txids;
  if (self.options.from >= 0 && self.options.to >= 0) {
    var fromOffset = totalCount - self.options.from;
    var toOffset = totalCount - self.options.to;
    txids = allTxids.slice(toOffset, fromOffset);
  } else {
    txids = allTxids;
  }

  // Verify that this query isn't too long
  if (txids.length > self.maxHistoryQueryLength) {
    return callback(new Error(
      'Maximum length query (' + self.maxHistoryQueryLength + ') exceeded for address(es): ' +
        self.addresses.join(',')
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
    if (inputAddress) {
      var inputAddressString = inputAddress.toString();
      if (this.addressStrings.indexOf(inputAddressString) >= 0) {
        if (!result.addresses[inputAddressString]) {
          result.addresses[inputAddressString] = {
            inputIndexes: [inputIndex],
            outputIndexes: []
          };
        } else {
          result.addresses[inputAddressString].inputIndexes.push(inputIndex);
        }
        result.satoshis -= input.output.satoshis;
      }
    }
  }

  for (var outputIndex = 0; outputIndex < transaction.outputs.length; outputIndex++) {
    var output = transaction.outputs[outputIndex];
    if (!output.script) {
      continue;
    }
    var outputAddress = output.script.toAddress(this.node.network);
    if (outputAddress) {
      var outputAddressString = outputAddress.toString();
      if (this.addressStrings.indexOf(outputAddressString) >= 0) {
        if (!result.addresses[outputAddressString]) {
          result.addresses[outputAddressString] = {
            inputIndexes: [],
            outputIndexes: [outputIndex]
          };
        } else {
          result.addresses[outputAddressString].outputIndexes.push(outputIndex);
        }
        result.satoshis += output.satoshis;
      }
    }
  }

  return result;

};

module.exports = AddressHistory;
