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
var Transform = require('stream').Transform;
var assert = require('assert');

var AddressService = function(options) {
  BaseService.call(this, options);
  this._tx = this.node.services.transaction;
  this._header = this.node.services.header;
  this._block = this.node.services.block;
  this._timestamp = this.node.services.timestamp;
  this._network = this.node.network;
  this._db = this.node.services.db;

  if (this._network === 'livenet') {
    this._network = 'main';
  }
  if (this._network === 'regtest') {
    this._network = 'testnet';
  }

};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'db',
  'block',
  'header',
  'transaction',
  'timestamp'
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

  }, function(err, txLists) {

    if(err) {
      return callback(err);
    }

    var txList = _.flatten(txLists);

    var results = {
      totalCount: txList.length,
      items: txList
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
    lte: end
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
    assert(result.balance >= 0, 'Balance can\'t be less than zero.');
    result.totalReceived = Unit.fromSatoshis(result.totalReceivedSat).toBTC();
    result.totalSent = Unit.fromSatoshis(result.totalSentSat).toBTC();
    result.unconfirmedBalance = result.unconfirmedBalanceSat;
    result.transactions = _.uniq(result.transactions);
    callback(null, result);
  });

  // pipe txids into tx stream for processing
  txidStream.pipe(txStream);

  txStream._transform = function(chunk, enc, callback) {

    // in the case where an address appears in both an input -and-
    // an output (sending money to one's self or using the sending
    // address as the change address (not recommended), we will get
    // duplicates. We don't want to look up the tx again.
    // Luckily, due to the way leveldb stores keys, we should get
    // txids out in lexigraphical order, so we can use an LRU here
    var key = self._encoding.decodeAddressIndexKey(chunk);

    self._tx.getTransaction(key.txid, options, function(err, tx) {

      if(err) {
        log.error(err);
        txStream.emit('error', err);
        return;
      }

      if (!tx) {
        log.error('Could not find tx for txid: ' + key.txid + '. This should not be possible, check indexes.');
        txStream.emit('error', new Error('Txid should map to a tx.'));
        return;
      }

      var confirmations = self._header.getBestHeight() - key.height + 1;

      result.transactions.push(tx.txid());
      result.txApperances++;
      // is this an input?
      if (key.input) {

        result.balanceSat -= tx.__inputValues[key.index];
        result.totalSentSat += tx.__inputValues[key.index];

        if (confirmations < 1) {
          result.unconfirmedBalanceSat -= tx.__inputValues[key.index];
          result.unconfirmedTxApperances++;
        }

        return callback();

      }

      result.balanceSat += tx.outputs[key.index].value;
      result.totalReceivedSat += tx.outputs[key.index].value;

      if (confirmations < 1) {
        result.unconfirmedBalanceSat += tx.__inputValues[key.index];
        result.unconfirmedTxApperances++;
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
  var final = new Buffer(new Array(73).join('f'), 'hex');
  var end = Buffer.concat([ start.slice(0, -36), final ]);

  var criteria = {
    gte: start,
    lt: end
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
      height: value.height,
      satoshis: value.satoshis,
      confirmationsFromCache: true
    });

  });

};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 1]
  ];
};

AddressService.prototype.start = function(callback) {

  var self = this;

  this._db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self._encoding = new Encoding(prefix);
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
  options.start = options.start || 0;
  options.end = options.end || 0xffffffff;

  var endHeightBuf = new Buffer(4);
  endHeightBuf.writeUInt32BE(options.end);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  var results = [];
  var start = self._encoding.encodeAddressIndexKey(address, options.start);
  var end = Buffer.concat([
    start.slice(0, address.length + 4),
    endHeightBuf,
    new Buffer(new Array(83).join('f'), 'hex')
  ]);

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
        txStream.emit('error', err);
        return callback();
      }

      assert(tx.__height >- 0, 'tx must have a height');
      self._header.getBlockHeader(tx.__height, function(err, hash) {

        if(err) {
          log.error(err);
          txStream.emit('error', err);
          return callback();
        }

        tx.__blockhash = hash;

        var outputSatoshis = 0;
        tx.outputs.forEach(function(output) {
          outputSatoshis += output.value;
        });

        var inputSatoshis = 0;
        tx.__inputValues.forEach(function(value) {
          inputSatoshis += value;
        });

        tx.__outputSatoshis = outputSatoshis;
        tx.__inputSatoshis = inputSatoshis;
        results.push(tx);
        callback();

      });

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

AddressService.prototype._removeBlock = function(block, callback) {
  var self = this;
  async.eachSeries(block.txs, function(tx, next) {
    self._removeTx(tx, block, next);
  }, callback);
};

AddressService.prototype._removeTx = function(tx, block, callback) {
  var self = this;
  async.parallelLimit([
    function(next) {
      async.eachOfSeries(tx.inputs, function(input, indext, next) {
        self._removeInput(input, tx, block, index, next);
      }, next);
    },
    function(next) {
      async.eachOfSeries(tx.outputs, function(output, index, next) {
        self._removeOutput(output, tx, block, index, next);
      }, next);
    }
  ], 4, callback);
};

AddressService.prototype._removeInput = function(input, tx, block, index, callback) {

  var self = this;
  var address = input.getAddress();
  var removalOps = [];

  if (!address) {
    return callback();
  }

  address.network = self._network;
  address = address.toString();

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.height, tx.txid(), index, 1, block.ts)
  });

  // look up prev output of this input and put it back in the set of utxos
  self._transaction.getTransaction(input.prevout.txid(), function(err, _tx) {

    if (err) {
      return callback(err);
    }

    assert(_tx, 'Missing prev tx to insert back into the utxo set when reorging address index.');

    removalOps.push({
      type: 'put',
      key: self._encoding.encodeUtxoIndexKey(address, _tx.txid(), input.prevout.index),
      value: self._encoding.encodeUtxoIndexValue(
        _tx.height,
        _tx.__inputValues[input.prevout.index],
        _tx.timestamp, _tx.outputs[input.prevout.index].script.toRaw())
    });

    callback(null, removalOps);

  });
};

AddressService.prototype._removeOutput = function(output, tx, block, index, callback) {

  var self = this;
  var address = output.getAddress();
  var removalOps = [];

  if (!address) {
    return callback();
  }

  address.network = self._network;
  address = address.toString();

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.height, tx.txid(), index, 0, block.ts)
  });

  //remove the utxo for this output from the collection
  removalOps.push({
    type: 'del',
    key: self._encoding.encodeUtxoIndexKey(address, tx.txid(), index)
  });

  callback(null, removalOps);
};

AddressService.prototype.onReorg = function(args, callback) {

  var self = this;

  var oldBlockList = args[1];

  // for every tx, remove the address index key for every input and output
  // for every input record, we need to find its previous output and put it back into the utxo collection
  async.eachSeries(oldBlockList, self._removeBlock.bind(self), function(err, ops) {

    if (err) {
      return callback(err);
    }

    callback(null, _.compact(_.flatten(ops)));
  });

};

AddressService.prototype.onBlock = function(block, callback) {
  var self = this;

  if (self.node.stopping) {
    return callback();
  }

  var operations = [];

  for(var i = 0; i < block.txs.length; i++) {
    var tx = block.txs[i];
    var ops = self._processTransaction(tx, { block: block });
    operations.push(ops);
  }

  operations = _.flatten(operations);

  callback(null, operations);
};

AddressService.prototype._processInput = function(tx, input, index, opts) {

  var address = input.getAddress();

  if(!address) {
    return;
  }

  address.network = this._network;
  address = address.toString();

  var txid = tx.txid();
  var timestamp = this._timestamp.getTimestampSync(opts.block.rhash());

  assert(timestamp, 'Must have a timestamp in order to process input.');

  // address index
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, txid, index, 1, timestamp);

  var operations = [{
    type: 'put',
    key: addressKey
  }];

  // prev utxo
  var rec = {
    type: 'del',
    key: this._encoding.encodeUtxoIndexKey(address, input.prevout.txid(), input.prevout.index)
  };

  operations.push(rec);

  return operations;
};

AddressService.prototype._processOutput = function(tx, output, index, opts) {

  var address = output.getAddress();

  if(!address) {
    return;
  }

  address.network = this._network;
  address = address.toString();

  var txid = tx.txid();
  var timestamp = this._timestamp.getTimestampSync(opts.block.rhash());

  assert(timestamp, 'Must have a timestamp in order to process output.');

  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.height, txid, index, 0, timestamp);

  var utxoKey = this._encoding.encodeUtxoIndexKey(address, txid, index);
  var utxoValue = this._encoding.encodeUtxoIndexValue(
    opts.block.height,
    output.value,
    timestamp,
    output.script.toRaw()
  );

  var operations = [{
    type: 'put',
    key: addressKey
  }];

  operations.push({
    type: 'put',
    key: utxoKey,
    value: utxoValue
  });

  return operations;

};

AddressService.prototype._processTransaction = function(tx, opts) {

  var self = this;

  var _opts = { block: opts.block };

  var outputOperations = tx.outputs.map(function(output, index) {
    return self._processOutput(tx, output, index, _opts);
  });

  outputOperations = _.flatten(_.compact(outputOperations));
  assert(outputOperations.length % 2 === 0 &&
    outputOperations.length <= tx.outputs.length * 2,
    'Output operations count is not reflective of what should be possible.');

  var inputOperations = tx.inputs.map(function(input, index) {
    return self._processInput(tx, input, index, _opts);
  });

  inputOperations = _.flatten(_.compact(inputOperations));

  assert(inputOperations.length % 2 === 0 &&
    inputOperations.length <= tx.inputs.length * 2,
    'Input operations count is not reflective of what should be possible.');

  outputOperations = outputOperations.concat(inputOperations);
  return outputOperations;

};

module.exports = AddressService;
