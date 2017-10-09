'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var _ = require('lodash');
var async = require('async');
var assert = require('assert');

function TransactionService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._mempool = this.node.services.mempool;
  this._block = this.node.services.block;
  this._header = this.node.services.header;
  this._p2p = this.node.services.p2p;
  this._timestamp = this.node.services.timestamp;
  this._address = this.node.services.address;
  this._network = this.node.network;

  if (this._network === 'livenet') {
    this._network = 'main';
  }
  if (this._network === 'regtest') {
    this._network = 'testnet';
  }
}

inherits(TransactionService, BaseService);

TransactionService.dependencies = [
  'p2p',
  'db',
  'timestamp',
  'mempool',
  'block',
  'header'
];

// ---- start public function protorypes
TransactionService.prototype.getAPIMethods = function() {
  return [
    ['getRawTransaction', this, this.getRawTransaction, 1],
    ['getTransaction', this, this.getTransaction, 1],
    ['getDetailedTransaction', this, this.getDetailedTransaction, 1],
    ['setTxMetaInfo', this, this.setTxMetaInfo, 2]
  ];
};

TransactionService.prototype._getDoubleSpentTxID = function(tx, callback) {
  // for there to be a tx in our mempool that is double spending this tx,
  // then at least one other tx in the mempool must be spending at least one of the
  // outputs that this tx is spending

  // TODO
  // we don't index the mempool to easily handle this because we would have to exhaustively
  // search through all of the mempool txs

  // we should probably have an index whose key is prevtxid + output index + spendingtxid and no value
  // then we could quickly loop over all inputs and get their spending txids in a list.
  // then subtract the list and this will be your double spending txids.

  // when a new block comes in, it may confirm up to one of those tx's. It should be very easily to
  // delete the correct one because we have the block and the tx.
  return callback();

};

TransactionService.prototype._getConfirmationsForInputs = function(tx, callback) {
  // for every input, check to see if its referenced input is confirmed.
  return callback();
};

TransactionService.prototype._getSpentInformationForOutputs = function(tx, callback) {

  var self = this;

  async.mapLimit(tx.outputs, 4, function(output, next) {

    var address = output.getAddress();

    if (!address) {
      return next();
    }

    address.network = self._network;
    address = address.toString();

    self._address._getInputInfoForAddress(address, next);

  }, function(err) {

    if(err) {
      return callback(err);
    }

    // we have an array for every output representing all the input info for the address
    // we need to take each txid in the input info and get the tx but only if the height is greater this
    // tx's height

    callback();




  });

};

TransactionService.prototype.getDetailedTransaction =
TransactionService.prototype.getTransaction = function(txid, options, callback) {

  var self = this;

  if (typeof callback !== 'function') {
    callback = options;
  }

  async.waterfall([
    self._getTransaction.bind(self, txid, options),
    self._getSupplementaryTransactionInfo.bind(self),
    self._getMempoolTransaction.bind(self),
    self.setTxMetaInfo.bind(self)
  ], callback);

};

TransactionService.prototype._getSupplementaryTransactionInfo = function(txid, tx, options, callback) {

  if (!tx) {
    return callback(null, txid, tx, options);
  }

  var self = this;
  tx.confirmations = self._block.getTip().height - tx.__height + 1;

  // TODO maybe we should index the block hash along with the height on tx
  self._header.getBlockHeader(tx.__height, function(err, header) {

    if (err) {
      return callback(err);
    }

    if (header) {
      // Do we need both of these?
      tx.blockhash = header.hash;
      tx.__blockhash = header.hash;
    }

    callback(null, txid, tx, options);

  });
};

TransactionService.prototype.setTxMetaInfo = function(tx, options, callback) {

  var self = this;

  if (!tx) {
    return callback();
  }

  async.waterfall([
    function(next) {
      if (tx.__inputValues) {
        return next(null, tx);
      }
      // the tx's that contain these input values could, themselves be unconfirmed
      // we are also assuming that this tx is from thet mempool
      self._getInputValues(tx, options, function(err, inputValues) {

        if (err) {
          return callback(err);
        }

        tx.__inputValues = inputValues;
        tx.confirmations = 0;
        tx.blockHash = null;
        tx.__blockHash = null;
        next(null, tx);

      });
    },
    function(tx, next) {

      // output values
      var outputSatoshis = 0;

      tx.outputs.forEach(function(output) {
        outputSatoshis += output.value;
      });

      tx.outputSatoshis = outputSatoshis;

      //input values
      if (!tx.inputs[0].isCoinbase()) {

        var inputSatoshis = 0;

        assert(tx.__inputValues.length === tx.inputs.length,
        'Transaction Service: input values length is not the same as the number of inputs.');

        tx.__inputValues.forEach(function(val) {

          if (val >+ 0) {
            inputSatoshis += val;
          }
        });

        var feeSatoshis = inputSatoshis - outputSatoshis;
        tx.inputSatoshis = inputSatoshis;
        tx.feeSatoshis = feeSatoshis;

      }

      next(null, tx);
    }
  ], function(err, tx) {
    if (err) {
      return callback(err);
    }
    callback(null, tx);
  });

};

TransactionService.prototype._getMempoolTransaction = function(txid, tx, options, callback) {

  var self = this;
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;

  if (tx || !queryMempool) {
    return callback(null, tx, options);
  }

  self._mempool.getMempoolTransaction(txid, function(err, tx) {

    if (err) {
      return callback(err);
    }

    if (!tx) {
      return callback(null, tx, options);
    }

    callback(null, tx, options);
  });

};

TransactionService.prototype._getTransaction = function(txid, options, callback) {

  var self = this;

  // txs will be in the index, the current block at LOWER tx indexes
  // or they don't exist for the purposes of this function
  // inputValues will be on the tx already by this point.
  var currentBlockTx = options && options.processedTxs &&
    options.processedTxs[txid] ? options.processedTxs[txid] : null;

  if (currentBlockTx) {
    return setImmediate(function() {
      callback(null, txid, currentBlockTx, options);
    });
  }

  var key = self._encoding.encodeTransactionKey(txid);
  self._db.get(key, function(err, tx) {

    if (err) {
      return callback(err);
    }

    if (!tx) {
      return callback(null, txid, tx, options);
    }

    tx = self._encoding.decodeTransactionValue(tx);
    callback(null, txid, tx, options);

  });

};

TransactionService.prototype._getInputValues = function(tx, options, callback) {

  var self = this;

  var _tx = tx;

  async.mapLimit(tx.inputs, 4, function(input, next) {

    if (input.isCoinbase()) {
      return next(null, 0);
    }

    var outputIndex = input.prevout.index;

    async.waterfall([
      // check tx index first, most likely place
      function(next) {
        self._getTransaction(input.prevout.txid(), options, next);
      },
      // if not there, then check mempool
      function(txid, tx, options, next) {
        if (tx) {
          return next(null, txid, tx);
        }
        self._mempool.getMempoolTransaction(input.prevout.txid(), function(err, memTx) {
          if (err) {
            return next(err);
          }
          next(null, txid, memTx);
        });
      },
      // if not in mempool or tx index, we just don't have it, yet?
      function(txid, tx, next) {
        if (!tx) {
          return next(new Error('Transaction Service: prev transacion: (' + input.prevout.txid() + ') for tx: ' +
            _tx.txid() + ' at input index: ' + outputIndex + ' is missing from the index or not in the memory pool. It could  be' +
            ' that the parent tx has not yet been relayed to us, but will be relayed in the near future.'));
        }
        var output = tx.outputs[outputIndex];

        assert(output, 'Expected an output, but did not get one for tx: ' + tx.txid() + ' outputIndex: ' + outputIndex);

        next(null, output.value);
      }
    ], function(err, val) {
      if (err) {
        return next(err);
      }
      next(null, val);
    });
  }, callback);

};

TransactionService.prototype.start = function(callback) {

  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self._encoding = new Encoding(self.prefix);
    callback();

  });
};

TransactionService.prototype.stop = function(callback) {
  setImmediate(callback);
};

// --- start private prototype functions
TransactionService.prototype._getBlockTimestamp = function(hash) {
  return this._timestamp.getTimestampSync(hash);
};

TransactionService.prototype.onBlock = function(block, callback) {

  var self = this;
  var processedTxs = {};

  if (self.node.stopping) {
    return callback();
  }

  async.mapSeries(block.txs, function(tx, next) {

    processedTxs[tx.txid()] = tx;
    self._processTransaction(tx, { block: block, processedTxs: processedTxs }, next);

  }, function(err, operations) {

    if (err) {
      return callback(err);
    }

    assert(block.txs.length === operations.length, 'It seems we are not indexing the correct number of transactions.');

    callback(null, operations);
  });

};

TransactionService.prototype.onReorg = function(args, callback) {

  var self = this;

  var oldBlockList = args[1];

  var removalOps = [];

  for(var i = 0; i < oldBlockList.length; i++) {

    var block = oldBlockList[i];

    for(var j = 0; j < block.txs.length; j++) {

      var tx = block.txs[j];

      removalOps.push({
        type: 'del',
        key: self._encoding.encodeTransactionKey(tx.txid())
      });

    }
  }

  setImmediate(function() {
    callback(null, removalOps);
  });

};

TransactionService.prototype._processTransaction = function(tx, opts, callback) {

  // this index is very simple txid -> tx, but we also need to find each
  // input's prev output value, the adjusted timestamp for the block and
  // the tx's block height

  var self = this;

  self._getInputValues(tx, opts, function(err, inputValues) {

    if (err) {
      return callback(err);
    }

    assert(inputValues && inputValues.length === tx.inputs.length,
      'Input values missing from tx.');

    // inputValues
    tx.__inputValues = inputValues;

    // timestamp
    tx.__timestamp = self._getBlockTimestamp(opts.block.rhash());
    assert(tx.__timestamp, 'Timestamp is required when saving a transaction.');

    // height
    tx.__height = opts.block.__height;
    assert(tx.__height, 'Block height is required when saving a trasnaction.');

    callback(null, {
      key: self._encoding.encodeTransactionKey(tx.txid()),
      value: self._encoding.encodeTransactionValue(tx)
    });
  });

};

module.exports = TransactionService;
