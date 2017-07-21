'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var bitcore = require('bitcore-lib');
var Unit = bitcore.Unit;
var _ = bitcore.deps._;
var Encoding = require('./encoding');
var utils = require('../../utils');
var Transform = require('stream').Transform;

var AddressService = function(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._tx = this.node.services.transaction;
  this._network = this.node.getNetworkName();
  this._p2p = this.node.services.p2p;
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'p2p',
  'db',
  'block',
  'transaction'
];

// ---- public function prototypes
AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;
  options.queryMempool = _.isUndefined(options.queryMempool) ? true : false;

  async.mapLimit(addresses, 4, function(address, next) {

    self._getAddressHistory(address, options, next);

  }, function(err, res) {

    if(err) {
      return callback(err);
    }

    var results = {
      totalItems: res.length,
      from: options.from,
      to: options.to,
      items: res
    };

    callback(null, results);

  });

};

AddressService.prototype.getAddressSummary = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;
  options.queryMempool = _.isUndefined(options.queryMempool) ? true : false;

  var result = {
    addrStr: address,
    balance: 0,
    balanceSat: 0,
    totalReceived: 0,
    totalReceivedSat: 0,
    totalSent: 0,
    totalSentSat: 0,
    unconfirmedBalance: 0,
    unconfirmedBalanceSat: 0,
    unconfirmedTxApperances: 0,
    txApperances: 0,
    transactions: []
  };

  // txid criteria
  var start = self._encoding.encodeAddressIndexKey(address, options.from);
  var end = self._encoding.encodeAddressIndexKey(address, options.to);

  var criteria = {
    gte: start,
    lt: end
  };

  // txid stream
  var txidStream = self._db.createKeyStream(criteria);

  txidStream.on('close', function() {
    txidStream.unpipe();
  });

  // tx stream
  var txStream = new Transform({ objectMode: true, highWaterMark: 1000 });
  txStream.on('end', function() {
    result.balance = Unit.fromSatoshis(result.balanceSat).toBTC();
    result.totalReceived = Unit.fromSatoshis(result.totalReceivedSat).toBTC();
    result.totalSent = Unit.fromSatoshis(result.totalSentSat).toBTC();
    result.unconfirmedBalance = Unit.fromSatoshis(result.unconfirmedBalanceSat).toBTC();
    callback(null, result);
  });

  // pipe txids into tx stream for processing
  txidStream.pipe(txStream);

  txStream._transform = function(chunk, enc, callback) {

    var key = self._encoding.decodeAddressIndexKey(chunk);

    self._tx.getTransaction(key.txid, options, function(err, tx) {

      if(err) {
        log.error(err);
        txStream.emit('error', err);
        return callback();
      }

      if (!tx) {
        log.error('Could not find tx for txid: ' + key.txid + '. This should not be possible, check indexes.');
        return callback();
      }

      var confirmations = self._p2p.getBestHeight() - key.height;
      result.transactions.push(tx.txid());
      result.txApperances++;

      if (key.input) {

        result.balanceSat -= tx.__inputValues[key.index];
        result.totalSentSat += tx.__inputValues[key.index];

        if (confirmations < 1) {
          result.unconfirmedBalanceSat -= tx.__inputValues[key.index];
          result.unconfirmedTxApperances++;
        }

      } else {

        result.balanceSat += tx.outputs[key.index].value;
        result.totalReceivedSat += tx.outputs[key.index].value;

        if (confirmations < 1) {
          result.unconfirmedBalanceSat += tx.inputValues[key.index];
          result.unconfirmedTxApperances++;
        }
      }

      callback();

    });

  };

  txStream.on('error', function(err) {
    log.error(err);
    txStream.unpipe();
  });

  txStream._flush = function(callback) {
    txStream.emit('end');
    callback();
  };
};

AddressService.prototype.getAddressUnspentOutputs = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;
  options.queryMempool = _.isUndefined(options.queryMempool) ? true : false;

  var results = [];

  var start = self._encoding.encodeUtxoIndexKey(address);
  var criteria = {
    gte: start,
    lt: utils.getTerminalKey(start)
  };

  var utxoStream = self._db.createReadStream(criteria);

  var streamErr;
  utxoStream.on('end', function() {
    if (streamErr) {
      return callback(streamErr);
    }
    callback(null, results);
  });

  utxoStream.on('error', function(err) {
    streamErr = err;
  });

  utxoStream.on('data', function(data) {
    var key = self._encoding.decodeUtxoIndexKey(data.key);
    var value =  self._encoding.decodeUtxoIndexValue(data.value);
    results.push({
      address: address,
      txid: key.txid,
      vout: key.outputIndex,
      ts: value.timestamp,
      scriptPubKey: value.script.toString('hex'),
      amount: Unit.fromSatoshis(value.satoshis).toBTC(),
      confirmations: self._p2p.getBestHeight() - value.height,
      satoshis: value.satoshis,
      confirmationsFromCache: true
    });
  });

};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 1],
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};

AddressService.prototype.start = function(callback) {

  var self = this;

  this._db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self._encoding = new Encoding(prefix);
    self._startSubscriptions();
    callback();
  });
};

AddressService.prototype.stop = function(callback) {
  setImmediate(callback);
};


// ---- start private function prototypes
AddressService.prototype._getAddressHistory = function(address, options, callback) {

  var self = this;

  options = options || {};
  var from = options.from || 0;
  var to = options.to || 0xffffffff;

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  var results = [];
  var start = self._encoding.encodeAddressIndexKey(address, options.start);
  var end = self._encoding.encodeAddressIndexKey(address, options.end);

  var criteria = {
    gte: start,
    lte: end
  };

  // txid stream
  var txidStream = self._db.createKeyStream(criteria);

  txidStream.on('close', function() {
    txidStream.unpipe();
  });

  // tx stream
  var txStream = new Transform({ objectMode: true, highWaterMark: 1000 });

  var streamErr;
  txStream.on('end', function() {
    if (streamErr) {
      return callback(streamErr);
    }
    callback(null, results);
  });

  // pipe txids into tx stream for processing
  txidStream.pipe(txStream);

  txStream._transform = function(chunk, enc, callback) {

    var key = self._encoding.decodeAddressIndexKey(chunk);

    self._tx.getTransaction(key.txid, options, function(err, tx) {

      if(err) {
        log.error(err);
        txStream.emit('error', err);
        return callback();
      }

      if (!tx) {
        log.error('Could not find tx for txid: ' + key.txid + '. This should not be possible, check indexes.');
        return callback();
      }

      results.push(tx);

      callback();

    });

  };

  txStream.on('error', function(err) {
    log.error(err);
    txStream.unpipe();
  });

  txStream._flush = function(callback) {
    txStream.emit('end');
    callback();
  };

};

AddressService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('block/block', this._onBlock.bind(this));
  this._bus.on('block/reorg', this._onReorg.bind(this));

  this._bus.subscribe('block/reorg');
  this._bus.subscribe('block/block');
};

AddressService.prototype._onReorg = function(oldBlockList, commonAncestor) {

  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (this._tip.height <= commonAncestor.height) {
    return;
  }

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ hash: commonAncestor.hash, height: commonAncestor.height }, this.name);

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  // for every tx, remove the address index key for every input and output
  for(var i = 0; i < oldBlockList.length; i++) {
    var block = oldBlockList[i];
    //txs
    for(var j = 0; j < block.transactions.length; j++) {
      var tx = block.transactions[j];

      //inputs
      var address;
      for(var k = 0; k < tx.inputs.length; k++) {
        var input = tx.inputs[k];
        address = utils.getAddressString({ tx: tx, item: input, network: this._network });

        if (!address) {
          continue;
        }

        removalOps.push({
          type: 'del',
          key: this.encoding.encodeTransactionKey(address, block.height, tx.id, k, 1)
        });
      }

      //outputs
      for(k = 0; k < tx.outputs.length; k++) {
        var output = tx.outputs[k];
        address = utils.getAddressString({ tx: tx, item: output, network: this._network });

        if (!address) {
          continue;
        }

        removalOps.push({
          type: 'del',
          key: this.encoding.encodeTransactionKey(address, block.height, tx.id, k, 0)
        });

      }
    }
  }

  this._db.batch(removalOps);

};

AddressService.prototype._onBlock = function(block) {
  var self = this;

  var operations = [];

  block.txs.forEach(function(tx) {
    operations.concat(self._processTransaction(tx, { block: block }));
  });

  if (operations && operations.length > 0) {

    self._db.batch(operations);

  }
};

AddressService.prototype._processInput = function(tx, input, opts) {

  var address = utils.getAddressString({ item: input });

  if(!address) {
    return;
  }

  var txid = tx.txid();
  // address index
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, txid);

  var operations = [{
    type: 'put',
    key: addressKey
  }];

  // prev utxo
  var rec = {
    type: 'del',
    key: this._encoding.encodeUtxoIndexKey(address, input.prevout.txid(), input.prevout.index)
  };

  // In the event where we are reorg'ing,
  // this is where we are putting a utxo back in, we don't know what the original height, sats, or scriptBuffer
  // since this only happens on reorg and the utxo that was spent in the chain we are reorg'ing away from will likely
  // be spent again sometime soon, we will not add the value back in, just the key

  operations.push(rec);

  return operations;
};

AddressService.prototype._processOutput = function(tx, output, index, opts) {

  var address = utils.getAddressString({ item: output });

  if(!address) {
    return;
  }

  var txid = tx.txid();
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, txid);
  var utxoKey = this._encoding.encodeUtxoIndexKey(address, txid, index);
  var utxoValue = this._encoding.encodeUtxoIndexValue(opts.block.height, Unit.fromBTC(output.value).toSatoshis(), output.script.toRaw());

  var operations = [{
    type: 'put',
    key: addressKey
  }];

  operations.push({
    type: 'put',
    key: utxoKey,
    value: utxoValue
  });

};

AddressService.prototype._processTransaction = function(opts, tx) {

  var self = this;

  var _opts = { block: opts.block };

  var outputOperations = tx.outputs.map(function(output, index) {
    return self._processOutput(tx, output, index, _opts);
  });

  outputOperations = _.flatten(_.compact(outputOperations));

  var inputOperations = tx.inputs.map(function(input) {
    self._processInput(tx, input, _opts);
  });

  inputOperations = _.flatten(_.compact(inputOperations));

  return outputOperations.concat(inputOperations);

};

module.exports = AddressService;
