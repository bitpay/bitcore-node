'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var Unit = bitcore.Unit;
var _ = bitcore.deps._;
var Encoding = require('./encoding');
var utils = require('../../utils');
var Transform = require('stream').Transform;

var AddressService = function(options) {
  BaseService.call(this, options);
  this._txService = this.node.services.transaction;
  this._network = this.node.getNetworkName();
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db',
  'block',
  'transaction'
];

// ---- public function prototypes
AddressService.prototype.getUtxos = function(addresses, queryMempool, callback) {
  var self = this;

  if(!Array.isArray(addresses)) {
    addresses = [addresses];
  }

  var utxos = [];

  async.eachSeries(addresses, function(address, next) {
    self.getUtxosForAddress(address, queryMempool, function(err, unspents) {
      if(err && err instanceof errors.NoOutputs) {
        return next();
      } else if(err) {
        return next(err);
      }

      utxos = utxos.concat(unspents);
      next();
    });
  }, function(err) {
    callback(err, utxos);
  });
};

AddressService.prototype.getUtxosForAddress = function(address, queryMempool, callback) {

  var self = this;

  var stream = self.db.createReadStream({
    gte: self._encoding.encodeUtxoIndexKey(address),
    lt: self._encoding.encodeUtxoIndexKey(utils.getTerminalKey(new Buffer(address)))
  });

  var utxos = [];
  stream.on('data', function(data) {
    var key = self._encoding.decodeUtxoIndexKey(data.key);
    var value = self._encoding.decodeUtxoIndexValue(data.value);
    utxos.push({
      address: key.address,
      txid: key.txid,
      outputIndex: key.outputIndex,
      satoshis: value.satoshis,
      height: value.height,
      script: value.script
    });
  });

  stream.on('end', function() {
    return callback(null, utxos);
  });
  stream.on('error', function(err) {
    if(err) {
      return callback(err);
    }
  });
};

AddressService.prototype.start = function(callback) {

  var self = this;
  self._setListeners();

  this.db = this.node.services.db;
  this.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self.prefix = prefix;
    self._encoding = new Encoding(self.prefix);
    callback();
  });
};

AddressService.prototype.stop = function(callback) {
  setImmediate(callback);
};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 1],
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};

AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var self = this;

  options = options || {};
  var from = options.from || 0;
  var to = options.to || 0xffffffff;

  async.mapLimit(addresses, 4, function(address, next) {

    self._getAddressHistory(address, next);

  }, function(err, res) {

    if(err) {
      return callback(err);
    }

    var results = {
      totalItems: res.length,
      from: from,
      to: to,
      items: res
    };

    callback(null, results);

  });

};

AddressService.prototype._getAddressHistory = function(address, options, callback) {

  var self = this;

  var results = [];
  var start = self._encoding.encodeAddressIndexKey(address);

  var criteria = {
    gte: start,
    lte: utils.getTerminalKey(start)
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

    var key = self._encoding.decodeWalletTransactionKey(chunk);

    self._tx.getDetailedTransaction(key.txid, options, function(err, tx) {

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

AddressService.prototype.getAddressSummary = function(address, options, callback) {

  var self = this;

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

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
  var start = self._encoding.encodeAddressIndexKey(address);
  var criteria = {
    gte: start,
    lte: utils.getTerminalKey(start)
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

    var key = self._encoding.decodeWalletTransactionKey(chunk);

    self._tx.getTransaction(key.txid, options, function(err, res) {

      if(err) {
        log.error(err);
        txStream.emit('error', err);
        return callback();
      }

      if (!res) {
        log.error('Could not find tx for txid: ' + key.txid + '. This should not be possible, check indexes.');
        return callback();
      }

      var tx = res.tx;

      result.transactions.push(tx.id);
      result.txApperances++;

      if (key.input) {

        result.balanceSat -= tx.inputValues[key.index];
        result.totalSentSat += tx.inputValues[key.index];

        if (res.confirmations === 0) {

          result.unconfirmedBalanceSat -= tx.inputValues[key.index];
          result.unconfirmedTxApperances++;

        }

      } else {

        result.balanceSat += tx.outputs[key.index].satoshis;
        result.totalReceivedSat += tx.outputs[key.index].satoshis;

        if (res.confirmations === 0) {

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
  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

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
    var key = self._decodeUtxoIndexKey(data.key);
    var value =  self._encoding.decodeUtxoIndexValue(data.value);
    results.push({
      address: address,
      txid: key.txid,
      vout: key.oudputIndex,
      ts: null,
      scriptPubKey: value.scriptBuffer.toString('hex'),
      amount: Unit.fromSatoshis(value.satoshis).toBTC(),
      confirmations: self._p2p.getBestHeight() - value.height,
      satoshis: value.satoshis,
      confirmationsFromCache: true
    });
  });

};


// ---- private function prototypes
AddressService.prototype._setListeners = function() {

  var self = this;

  self.on('reorg', self._handleReorg.bind(self));

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
  this._bus.subscribe('block/block');
};

AddressService.prototype._onBlock = function(block) {
  var self = this;

  var operations = [];

  block.transactions.forEach(function(tx) {
    operations.concat(self._processTransaction(tx, { block: block }));
  });

  if (operations && operations.length > 0) {

    self._db.batch(operations);

  }
};

AddressService.prototype._processInput = function(opts, input) {

  var address = this._getAddress(opts, input);

  if (!address) {
    return;
  }

  // address index
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, opts.tx.id);

  var operations = [{
    type: opts.action,
    key: addressKey
  }];

  // prev utxo
  var rec = {
    type: opts.action,
    key: this._encoding.encodeUtxoIndexKey(address, input.prevTxId.toString('hex'), input.outputIndex)
  };

  // In the event where we are reorg'ing,
  // this is where we are putting a utxo back in, we don't know what the original height, sats, or scriptBuffer
  // since this only happens on reorg and the utxo that was spent in the chain we are reorg'ing away from will likely
  // be spent again sometime soon, we will not add the value back in, just the key

  operations.push(rec);

  return operations;
};

AddressService.prototype._processOutput = function(tx, output, index, opts) {

  var address = utils.getAddressString({ tx: tx, item: output, network: this._network });

  if(!address) {
    return;
  }

  var txid = tx.id;
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, txid);
  var utxoKey = this._encoding.encodeUtxoIndexKey(address, txid, index);
  var utxoValue = this._encoding.encodeUtxoIndexValue(opts.block.height, output.satoshis, output._scriptBuffer);

  var operations = [{
    type: opts.action,
    key: addressKey
  }];

  operations.push({
    type: opts.action,
    key: utxoKey,
    value: utxoValue
  });

};

AddressService.prototype._processTransaction = function(opts, tx) {

  var self = this;

  var action = 'put';
  var reverseAction = 'del';

  if (!opts.connect) {
    action = 'del';
    reverseAction = 'put';
  }

  var _opts = { block: opts.block, action: action, reverseAction: reverseAction };

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
