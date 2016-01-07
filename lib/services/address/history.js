'use strict';

var bitcore = require('bitcore-lib');
var async = require('async');
var CombinedStream = require('./streams/combined');
var _ = bitcore.deps._;

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
  this.combinedArray = [];
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

  var combinedStream = new CombinedStream({
    inputStream: this.node.services.address.createInputsStream(address, this.options),
    outputStream: this.node.services.address.createOutputsStream(address, this.options)
  });

  // Results from the transaction info stream are grouped into
  // sets based on block height
  combinedStream.on('data', function(block) {
    self.combinedArray = self.combinedArray.concat(block);
  });

  combinedStream.on('end', function() {
    totalCount = Number(self.combinedArray.length);

    self.sortAndPaginateCombinedArray();

    // TODO: Add the mempool transactions

    async.eachSeries(
      self.combinedArray,
      function(txInfo, next) {
        self.getDetailedInfo(txInfo, next);
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
          addresses: txInfo.addresses,
          satoshis: self.getSatoshisDetail(transaction, txInfo),
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

/**
 * A helper function for `getDetailedInfo` for getting the satoshis.
 * @param {Transaction} transaction - A transaction populated with previous outputs
 * @param {Object} txInfo - An item from `combinedArray`
 */
AddressHistory.prototype.getSatoshisDetail = function(transaction, txInfo) {
  var satoshis = txInfo.satoshis || 0;

  for(var address in txInfo.addresses) {
    if (txInfo.addresses[address].inputIndexes.length >= 0) {
      for(var j = 0; j < txInfo.addresses[address].inputIndexes.length; j++) {
        satoshis -= transaction.inputs[txInfo.addresses[address].inputIndexes[j]].output.satoshis;
      }
    }
  }

  return satoshis;
};

module.exports = AddressHistory;
