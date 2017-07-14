'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var Address = bitcore.Address;
var Encoding = require('./encoding');
var utils = require('../../utils');

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
AddressService.prototype.getBalance = function(address, queryMempool, callback) {
  this.getUtxos(address, queryMempool, function(err, outputs) {
    if(err) {
      return callback(err);
    }

    var satoshis = outputs.map(function(output) {
      return output.satoshis;
    });

    var sum = satoshis.reduce(function(a, b) {
      return a + b;
    }, 0);

    return callback(null, sum);
  });
};


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
    ['getAddressBalance', this, this.getAddressBalance, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1],
    ['getAddressTxids', this, this.getAddressTxids, 2],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 1],
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};

AddressService.prototype.getAddressBalance = function(addresses, options, callback) {

  var self = this;
  addresses = utils.normalizeAddressArg(addresses);
  var balance = 0;

  async.eachLimit(addresses, 4, function(address, next) {

    var start = self._encoding.encodeUtxoIndexKey(address);
    var criteria = {
      gte: start,
      lte: Buffer.concat([ start.slice(-36), new Buffer(new Array(73).join('f'), 'hex') ])
    };

    var stream = this._db.createReadStream(criteria);
    stream.on('data', function(data) {

    });
    stream.on('error', function(err) {
    });
    stream.on('end', function() {
    });
  });

};

AddressService.prototype.getAddressHistory = function(addresses, options, callback) {

  var self = this;
  var txids = [];

  async.eachLimit(addresses, 4, function(address, next) {
    self.getAddressTxids(address, options, function(err, tmpTxids) {
      if(err) {
        return next(err);
      }

      txids = _.union(txids, tmpTxids);
      return next();
    });
  }, function() {
    async.mapLimit(txids, 4, function(txid, next) {
      self.node.services.transaction.getTransaction(txid.toString('hex'), options, function(err, tx) {
        if(err) {
          return next(err);
        }

        var txObj = tx.toObject();
        for(var i = 0; i < txObj.inputs.length; i++) {
          txObj.inputs[i].satoshis = tx.__inputValues[i];
        }

        next(null, txObj);
      });
    }, callback);
  });
};

AddressService.prototype.getAddressSummary = function(addressArg, options, callback) {

  var self = this;

  var startTime = new Date();
  var address = new Address(addressArg);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  async.waterfall([
    function(next) {
      self._getAddressConfirmedSummary(address, options, next);
    },
    function(result, next) {
      self._getAddressMempoolSummary(address, options, result, next);
    },
    function(result, next) {
      self._setAndSortTxidsFromAppearanceIds(result, next);
    }
  ], function(err, result) {
    if (err) {
      return callback(err);
    }

    var summary = self._transformAddressSummaryFromResult(result, options);

    var timeDelta = new Date() - startTime;
    if (timeDelta > 5000) {
      var seconds = Math.round(timeDelta / 1000);
      log.warn('Slow (' + seconds + 's) getAddressSummary request for address: ' + address.toString());
    }

    callback(null, summary);

  });

};

AddressService.prototype.getAddressTxids = function(address, options, callback) {
  var self = this;

  var opts = options || { start: 0, end: 0xffffffff, txid: new Array(65).join('0') };
  var txids = {};

  var start = self._encoding.encodeAddressIndexKey(address, opts.start, opts.txid);
  var end = self._encoding.encodeAddressIndexKey(address, opts.end, opts.txid);

  var stream = self.db.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;
  stream.on('close', function() {
  });

  stream.on('data', function(buffer) {
    var key = self._encoding.decodeAddressIndexKey(buffer);
    txids[key.txid] = true;
  });

  stream.on('end', function() {
    callback(streamErr, Object.keys(txids));
  });

  stream.on('error', function(err) {
    streamErr = err;
  });
};

AddressService.prototype.getAddressUnspentOutputs = function(address, options, callback) {

  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var addresses = utils._normalizeAddressArg(address);
  var cacheKey = addresses.join('');
  var utxos = this.utxosCache.get(cacheKey);

  function transformUnspentOutput(delta) {
    var script = bitcore.Script.fromAddress(delta.address);
    return {
      address: delta.address,
      txid: delta.txid,
      outputIndex: delta.index,
      script: script.toHex(),
      satoshis: delta.satoshis,
      timestamp: delta.timestamp
    };
  }

  function updateWithMempool(confirmedUtxos, mempoolDeltas) {
    if (!mempoolDeltas || !mempoolDeltas.length) {
      return confirmedUtxos;
    }
    var isSpentOutputs = false;
    var mempoolUnspentOutputs = [];
    var spentOutputs = [];

    for (var i = 0; i < mempoolDeltas.length; i++) {
      var delta = mempoolDeltas[i];
      if (delta.prevtxid && delta.satoshis <= 0) {
        if (!spentOutputs[delta.prevtxid]) {
          spentOutputs[delta.prevtxid] = [delta.prevout];
        } else {
          spentOutputs[delta.prevtxid].push(delta.prevout);
        }
        isSpentOutputs = true;
      } else {
        mempoolUnspentOutputs.push(transformUnspentOutput(delta));
      }
    }

    var utxos = mempoolUnspentOutputs.reverse().concat(confirmedUtxos);

    if (isSpentOutputs) {
      return utxos.filter(function(utxo) {
        if (!spentOutputs[utxo.txid]) {
          return true;
        } else {
          return (spentOutputs[utxo.txid].indexOf(utxo.outputIndex) === -1);
        }
      });
    }

    return utxos;
  }

  function finish(mempoolDeltas) {
    if (utxos) {
      return setImmediate(function() {
        callback(null, updateWithMempool(utxos, mempoolDeltas));
      });
    } else {
      self.client.getAddressUtxos({addresses: addresses}, function(err, response) {
        if (err) {
          return callback(self._wrapRPCError(err));
        }
        var utxos = response.result.reverse();
        self.utxosCache.set(cacheKey, utxos);
        callback(null, updateWithMempool(utxos, mempoolDeltas));
      });
    }
  }

  if (queryMempool) {
    self.client.getAddressMempool({addresses: addresses}, function(err, response) {
      if (err) {
        return callback(self._wrapRPCError(err));
      }
      finish(response.result);
    });
  } else {
    finish();
  }

};

AddressService.prototype.syncPercentage = function(callback) {
  return callback(null, ((this._tip.height / this._block.getBestBlockHeight()) * 100).toFixed(2) + '%');
};


AddressService.prototype.getAddressTxidsWithHeights = function(address, options, callback) {
  var self = this;

  var opts = options || {};
  var txids = {};

  var start = self._encoding.encodeAddressIndexKey(address, opts.start || 0);
  var end = Buffer.concat([ start.slice(0, -36), new Buffer((opts.end || 'ffffffff'), 'hex') ]);

  var stream = self.db.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(buffer) {
    var key = self._encoding.decodeAddressIndexKey(buffer);
    txids[key.txid] = key.height;
  });

  stream.on('end', function() {
    callback(streamErr, txids);
  });

  stream.on('error', function(err) {
    streamErr = err;
  });
};

// ---- private function prototypes
AddressService.prototype._setListeners = function() {

  var self = this;

  self._db.on('error', self._onDbError.bind(self));
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
    operations.concat(self._processTransaction(tx, { block: block, connect: connect }));
  });

  if (operations && operations.length > 0) {

    self._db.batch(operations, function(err) {

      if(err) {
        log.error('Address Service: Error saving block with hash: ' + block.hash);
        this._db.emit('error', err);
        return;
      }

      log.debug('Address Service: Success saving block hash ' + block.hash);
    });
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
