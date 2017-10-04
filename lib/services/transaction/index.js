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
    ['getDetailedTransaction', this, this.getDetailedTransaction, 1]
  ];
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
    self._setMetaInfo.bind(self)
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
      tx.blockHash = header.hash;
      tx.__blockHash = header.hash;
    }

    callback(null, txid, tx, options);

  });
};

TransactionService.prototype._setMetaInfo = function(tx, options, callback) {

  if (!tx) {
    return callback();
  }


  // output values
  var outputSatoshis = 0;

  tx.outputs.forEach(function(output) {
    outputSatoshis += output.value;
  });

  tx.outputSatoshis = outputSatoshis;


  //input values
  if (!tx.inputs[0].isCoinbase()) {

    var inputSatoshis = 0;

    tx.__inputValues.forEach(function(val) {

      if (val >+ 0) {
        inputSatoshis += val;
      }
    });

    var feeSatoshis = inputSatoshis - outputSatoshis;
    tx.inputSatoshis = inputSatoshis;
    tx.feeSatoshis = feeSatoshis;

  }

  callback(null, tx);

};

TransactionService.prototype._getMempoolTransaction = function(txid, tx, options, callback) {

  var self = this;
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;

  if (!tx) {
   console.log(txid);
  }
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

    self._getInputValues(tx, options, function(err, inputValues) {

      if (err) {
        return callback(err);
      }

      tx.__inputValues = inputValues;
      tx.confirmations = 0;
      tx.blockHash = null;
      tx.__blockHash = null;
      callback(null, tx, options);

    });

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

  async.mapLimit(tx.inputs, 4, function(input, next) {

    if (input.isCoinbase()) {
      return next(null, 0);
    }

    var outputIndex = input.prevout.index;

    self._getTransaction(input.prevout.txid(), options, function(err, txid, _tx) {

      if (err || !_tx) {
        return next(err || new Error('Transaction Service: tx not found for tx id: ' + input.prevout.txid()));
      }

      var output = _tx.outputs[outputIndex];
      assert(output, 'Expected an output, but did not get one for tx: ' + _tx.txid() + ' outputIndex: ' + outputIndex);
      next(null, output.value);

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
