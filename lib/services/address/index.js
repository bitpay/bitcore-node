'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var bitcore = require('bitcore-lib');
var Unit = bitcore.Unit;
var _ = bitcore.deps._;
var lodash = require('lodash');
var Encoding = require('./encoding');
var Transform = require('stream').Transform;
var assert = require('assert');
var utils = require('../../utils');
var LRU = require('lru-cache');
var XXHash = require('xxhash');



// See rationale about this cache at function getTxList(next)
const TXID_LIST_CACHE_ITEMS = 250;              // nr of items (this translates to: consecutive 
                                                // clients downloading their tx history)
const TXID_LIST_CACHE_EXPIRATION = 1000 * 30;   // ms
const TXID_LIST_CACHE_MIN = 100;                // Min items to cache
const TXID_LIST_CACHE_SEED = 0x3233DE;                // Min items to cache

var AddressService = function(options) {

  BaseService.call(this, options);
  this._header = this.node.services.header;
  this._block = this.node.services.block;
  this._timestamp = this.node.services.timestamp;
  this._transaction = this.node.services.transaction;
  this._network = this.node.network;
  this._db = this.node.services.db;
  this._mempool = this.node.services.mempool;
  this._txIdListCache = new LRU({
    max: TXID_LIST_CACHE_ITEMS,        
    maxAge: TXID_LIST_CACHE_EXPIRATION 
  });
 

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
  'timestamp',
  'mempool'
];

// this must return the to-from number of txs for ALL passed in addresses sort from latest txs to earliest
// for example if the query /api/addrs/txs?from=0&to=5&noAsm=1&noScriptSig=1&noSpent=1, and the addresses passed
// in are [addr1, addr2, addr3], then if addr3 has tx1 at height 10, addr2 has tx2 at height 9 and tx1 has no txs,
// then I would pass back [tx1, tx2] in that order
//
// Instead of passing addresses, with from>0, options.cacheKey can be used to define the address set.
//
AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var self = this;
  var cacheUsed = false;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;
  options.txIdList = [];

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  if (_.isString(addresses)) {
    addresses = [addresses];
  }


  function getTxList(next) {


    function hashAddresses(addresses) {

      // Given there are only TXID_LIST_CACHE_ITEMS ~ 250 items cached at the sametime
      // a 32 bits hash is secure enough

      return XXHash.hash(Buffer.from(addresses.join('')), TXID_LIST_CACHE_SEED);
    };

    var calculatedCacheKey;

    // We use the cache ONLY on from > 0 queries.
    //
    // Rationale: The a full history is downloaded, the client do
    // from =0, to=x
    // then from =x+1 to=y
    // then [...]
    // The objective of this cache is to speed up the from>0 queries, and also
    // "freeze" the txid list during download.
    //
    if (options.from >0 ) {
      
      let cacheKey  = options.cacheKey;
      if (!cacheKey) {
         calculatedCacheKey = hashAddresses(addresses);
         cacheKey =  calculatedCacheKey;
      }

      var txIdList  = self._txIdListCache.get(cacheKey);
      if (txIdList) {
        options.txIdList = txIdList;
        cacheUsed = true;
        return next();
      }
    }

    // Get the list from the db
    async.eachLimit(addresses, 4, function(address, next) {
      self._getAddressTxidHistory(address, options, next);
    }, function(err) {
      if (err) return next(err);

      var list = lodash.uniqBy(options.txIdList, function(x) { 
        return x.txid + x.height;
      });


      options.txIdList = lodash.orderBy(list,['height','txid'], ['desc','asc']);

      if (list.length > TXID_LIST_CACHE_MIN) {
        calculatedCacheKey  = calculatedCacheKey || hashAddresses(addresses);

        self._txIdListCache.set(calculatedCacheKey, options.txIdList);
      }

      return next();
    });

  };


  getTxList(function(err) {
    if(err) {
      return callback(err);
    }

    self._getAddressTxHistory(options, function(err, txList) {

      if (err) {
        return callback(err);
      }

      var results = {
        totalCount: options.txIdList.length || 0,
        items: txList,
      };

      // cacheUsed is returned for testing
      callback(null, results, cacheUsed);

    });
  });

};

// this is basically the same as _getAddressHistory apart from the summary
AddressService.prototype.getAddressSummary = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;

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
  };

  self.getAddressHistory(address, options, function(err, results) {

    if (err) {
      return callback(err);
    }

    var txs = results.items;
    self._getAddressSummaryResult(txs, address, result, options);

    result.balance = Unit.fromSatoshis(result.balanceSat).toBTC();
    result.totalReceived = Unit.fromSatoshis(result.totalReceivedSat).toBTC();
    result.totalSent = Unit.fromSatoshis(result.totalSentSat).toBTC();
    result.unconfirmedBalance = Unit.fromSatoshis(result.unconfirmedBalanceSat).toBTC();
    callback(null, result);
  });

};

AddressService.prototype._setOutputResults = function(tx, address, result) {

  for(var j = 0; j < tx.outputs.length; j++) {

    var output = tx.outputs[j];

    if (utils.getAddress(output, this._network) !== address) {
      continue;
    }

    result.txApperances++;
    result.totalReceivedSat += output.value;
    result.balanceSat += output.value;

    if (tx.confirmations === 0) {
      result.unconfirmedTxApperances++;
      result.unconfirmedBalanceSat += output.value;
    }

  }
  return result;

};

AddressService.prototype._setInputResults = function(tx, address, result) {
  for(var i = 0; i < tx.inputs.length; i++) {

    var input = tx.inputs[i];
    if (utils.getAddress(input, this._network) !== address) {
      continue;
    }

    result.totalSentSat += tx.__inputValues[i];
    result.balanceSat -= tx.__inputValues[i];

    if (tx.confirmations === 0) {
      result.unconfirmedBalanceSat -= tx.__inputValues[i];
    }

  }
};

AddressService.prototype._getAddressSummaryResult = function(txs, address, result, options) {

  var self = this;

  for(var i = 0; i < txs.length; i++) {

    var tx = txs[i];

    self._setOutputResults(tx, address, result);
    self._setInputResults(tx, address, result);

    if (!options.noTxList) {
      if (!result.transactions)  {
        result.transactions = [];
      }
      result.transactions.push(tx.txid());
    }

  }

  return result;
};

AddressService.prototype.getAddressUnspentOutputs = function(address, options, callback) {

  var self = this;

  options = options || {};
  options.from = options.from || 0;
  options.to = options.to || 0xffffffff;

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  var results = [];

  var start = self._encoding.encodeUtxoIndexKey(address);
  var final = new Buffer(new Array(73).join('f'), 'hex');
  var end = Buffer.concat([ start.slice(0, -36), final ]);

  var criteria = {
    gte: start,
    lt: end
  };

  async.waterfall([

    // query the mempool if necessary
    function(next) {

      if (!options.queryMempool) {
        return next(null, []);
      }

      self._mempool.getTxidsByAddress(address, 'output', next);
    },

    // if mempool utxos, then add them first
    function(mempoolTxids, next) {

      if (mempoolTxids.length <= 0) {
        return next();
      }

      async.eachLimit(mempoolTxids, 4, function(id, next) {

        self._mempool.getMempoolTransaction(id.txid, function(err, tx) {

          if (err || !tx) {
            return next(err || new Error('Address Service: missing tx: ' + id.txid));
          }

          results = results.concat(self._getMempoolUtxos(tx, address));
          next();

        });

      });

      next();
    },

    function(next) {

      var utxoStream = self._db.createReadStream(criteria);
      var streamErr;

      utxoStream.on('end', function() {

        if (streamErr) {
          return callback(streamErr);
        }

        results = utils.orderByConfirmations(results);
        next(null, results);

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
          confirmations: self._block.getTip().height - value.height + 1
        });

      });
    }
  ], callback);

};

AddressService.prototype._getMempoolUtxos = function(tx, address) {

  var results = [];

  for(var i = 0; i < tx.outputs.length; i++) {

    var output = tx.outputs[i];

    if (utils.getAddress(output, this._network) !== address) {
      continue;
    }

    results.push({
      address: address,
      txid: tx.txid(),
      vout: i,
      scriptPubKey: output.script.toRaw().toString('hex'),
      amount: Unit.fromSatoshis(output.value).toBTC(),
      height: null,
      satoshis: output.value,
      confirmations: 0
    });
  }

  return results;
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

AddressService.prototype._getTxidStream = function(address, options) {

  var start = this._encoding.encodeAddressIndexKey(address);
  var end = Buffer.concat([
    start.slice(0, address.length + 4),
    options.endHeightBuf,
    new Buffer(new Array(83).join('f'), 'hex')
  ]);

  var criteria = {
    gte: start,
    lte: end,
    reverse: true // txids stream from low confirmations to high confirmations
  };

  // txid stream
  var txidStream = this._db.createKeyStream(criteria);

  txidStream.on('close', function() {
    txidStream.unpipe();
  });

  return txidStream;
};

AddressService.prototype._getAddressTxHistory = function(options, callback) {

  var self = this;

  // slice the txids based on pagination needs
  var ids = options.txIdList.slice(options.from, options.to);

  // go and get the actual txs
  async.mapLimit(ids, 4, function(id, next) {

    if (id.height === 0xffffffff) {
      return self._mempool.getMempoolTransaction(id.txid, function(err, tx) {

        if (err || !tx) {
          return next(err || new Error('Address Service: could not find tx: ' + id.txid));
        }

        self._transaction.setTxMetaInfo(tx, options, next);

      });
    }

    self._transaction.getDetailedTransaction(id.txid, options, next);

  }, callback);

};

AddressService.prototype._getAddressTxidHistory = function(address, options, callback) {
  var self = this;

  options = options || {};
  options.start = options.start || 0;
  options.end = options.end || 0xffffffff;

  var results = [];

  options.endHeightBuf = new Buffer(4);
  options.endHeightBuf.writeUInt32BE(options.end);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  async.waterfall([

    // query the mempool for relevant txs for this address
    function(next) {

      if (!options.queryMempool) {
        return next(null, []);
      }

      self._mempool.getTxidsByAddress(address, 'both', next);
    },

    // add the meta data such as input values, etc.
    function(mempoolTxids, next) {

      if (mempoolTxids.length <= 0) {
        return next();
      }

      results = mempoolTxids;
      next();
    },
    // stream the rest of the confirmed txids out of the address index
    function(next) {

      var txIdTransformStream = new Transform({ objectMode: true });

      txIdTransformStream._flush = function(callback) {
        txIdTransformStream.emit('end');
        callback();
      };

      txIdTransformStream.on('error', function(err) {
        log.error('Address Service: txstream err: ' + err);
        txIdTransformStream.unpipe();
      });

      txIdTransformStream.on('end', function() {
        options.txIdList = options.txIdList.concat(results);
        next();
      });

      txIdTransformStream._transform = function(chunk, enc, callback) {
        var txInfo = self._encoding.decodeAddressIndexKey(chunk);
        results.push({ txid: txInfo.txid, height: txInfo.height });
        callback();
      };

      var txidStream = self._getTxidStream(address, options);
      txidStream.pipe(txIdTransformStream);

    }
  ], callback);

};

AddressService.prototype._removeBlock = function(block, callback) {

  var self = this;

  async.mapSeries(block.txs, function(tx, next) {

    self._removeTx(tx, block, next);

  }, callback);

};

AddressService.prototype._removeTx = function(tx, block, callback) {

  var self = this;
  var operations = [];

  async.parallelLimit([

    function(next) {
      async.eachOfSeries(tx.inputs, function(input, indext, next) {
        self._removeInput(input, tx, block, index, function(err, ops) {
          if(err) {
            return next(err);
          }
          operations = operations.concat(ops);
          next();
        });
      }, next);
    },

    function(next) {
      async.eachOfSeries(tx.outputs, function(output, index, next) {
        self._removeOutput(output, tx, block, index, function(err, ops) {
          if(err) {
            return next(err);
          }
          operations = operations.concat(ops);
          next();
        });
      }, next);
    }

  ], 4, function(err) {

    if(err) {
      return callback(err);
    }

    callback(null, operations);

  });

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

  assert(block && block.__ts && block.__height, 'Missing block or block values.');

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.__height, tx.txid(), index, 1, block.__ts)
  });

  // look up prev output of this input and put it back in the set of utxos
  self._transaction.getTransaction(input.prevout.txid(), function(err, _tx) {

    if (err) {
      return callback(err);
    }

    assert(_tx, 'Missing prev tx to insert back into the utxo set when reorging address index.');
    assert(_tx.__height && _tx.__inputValues && _tx.__timestamp, 'Missing tx values.');

    removalOps.push({
      type: 'put',
      key: self._encoding.encodeUtxoIndexKey(address, _tx.txid(), input.prevout.index),
      value: self._encoding.encodeUtxoIndexValue(
        _tx.__height,
        _tx.__inputValues[input.prevout.index],
        _tx.__timestamp, _tx.outputs[input.prevout.index].script.toRaw())
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

  assert(block && block.__ts && block.__height, 'Missing block or block values.');

  removalOps.push({
    type: 'del',
    key: self._encoding.encodeAddressIndexKey(address, block.__height, tx.txid(), index, 0, block.__ts)
  });

  //remove the utxo for this output from the collection
  removalOps.push({
    type: 'del',
    key: self._encoding.encodeUtxoIndexKey(address, tx.txid(), index)
  });

  setImmediate(function() {
    callback(null, removalOps);
  });
};

AddressService.prototype.onReorg = function(args, callback) {

  var self = this;

  var oldBlockList = args[1];

  // for every tx, remove the address index key for every input and output
  // for every input record, we need to find its previous output and put it back into the utxo collection
  async.mapSeries(oldBlockList, self._removeBlock.bind(self), function(err, ops) {

    if (err) {
      return callback(err);
    }

   var operations = lodash.compact(lodash.flattenDeep(ops));
    callback(null, operations);
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

  operations = lodash.flattenDeep(operations);

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
  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.__height, txid, index, 1, timestamp);

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

  // TODO: if the output is pay to public key, we are reporting this as p2pkh
  // this leads to the spending tx not being properly indexed. Txs that
  // spend p2pk outputs, will not have the public key as part of their input script sig
  var address = output.getAddress();

  if(!address) {
    return;
  }

  address.network = this._network;
  address = address.toString();

  var txid = tx.txid();
  var timestamp = this._timestamp.getTimestampSync(opts.block.rhash());

  assert(timestamp, 'Must have a timestamp in order to process output.');

  var addressKey = this._encoding.encodeAddressIndexKey(address, opts.block.__height, txid, index, 0, timestamp);

  var utxoKey = this._encoding.encodeUtxoIndexKey(address, txid, index);
  var utxoValue = this._encoding.encodeUtxoIndexValue(
    opts.block.__height,
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

  outputOperations = lodash.compact(lodash.flattenDeep(outputOperations));
  assert(outputOperations.length % 2 === 0 &&
    outputOperations.length <= tx.outputs.length * 2,
    'Output operations count is not reflective of what should be possible.');

  var inputOperations = tx.inputs.map(function(input, index) {
    return self._processInput(tx, input, index, _opts);
  });

  inputOperations = lodash.compact(lodash.flattenDeep(inputOperations));

  assert(inputOperations.length % 2 === 0 &&
    inputOperations.length <= tx.inputs.length * 2,
    'Input operations count is not reflective of what should be possible.');

  outputOperations = outputOperations.concat(inputOperations);
  return outputOperations;

};

module.exports = AddressService;
