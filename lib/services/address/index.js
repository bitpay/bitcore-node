'use strict';

var assert = require('assert');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var _ = require('lodash');
var Encoding = require('./encoding');
var utils = require('../../utils');

var AddressService = function(options) {
  BaseService.call(this, options);
};

inherits(AddressService, BaseService);

AddressService.dependencies = ['transaction'];

AddressService.prototype.start = function(callback) {
  var self = this;

  this.db = this.node.services.db;
  this.db.getPrefix(this.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;

    self._encoding = new Encoding(self.prefix);
    self._setListeners();
    callback();

  });
};

AddressService.prototype.stop = function(callback) {
  callback();
};

AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getOutputs', this, this.getOutputs, 2],
    ['getUtxos', this, this.getUtxos, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
};

AddressService.prototype.getPublishEvents = function() {
  return [];
};

AddressService.prototype._setupListeners = function() {
  this._startSubscriptions();
};

AddressService.prototype._startSubscriptions = function() {

  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self.bus = self.node.openBus({remoteAddress: 'localhost'});

  self.bus.subscribe('block/reorg');
  self.bus.on('block/block', self._onBlock.bind(self));
  self.bus.on('block/reorg', self._onReorg.bind(self));

};

AddressService.prototype._onBlock = function(block) {

};

AddressService.prototype._onReorg = function(commonAncestorBlock) {
};


AddressService.prototype.subscribe = function(name, emitter, addresses) {

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(!this.subscriptions[name][hashHex]) {
      this.subscriptions[name][hashHex] = [];
    }
    this.subscriptions[name][hashHex].push(emitter);
  }
};

AddressService.prototype.unsubscribe = function(name, emitter, addresses) {

  if(!addresses) {
    return this.unsubscribeAll(name, emitter);
  }

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(this.subscriptions[name][hashHex]) {
      var emitters = this.subscriptions[name][hashHex];
      var index = emitters.indexOf(emitter);
      if(index > -1) {
        emitters.splice(index, 1);
      }
    }
  }
};

AddressService.prototype.unsubscribeAll = function(name, emitter) {

  for(var hashHex in this.subscriptions[name]) {
    var emitters = this.subscriptions[name][hashHex];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
    }
  }
};

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

AddressService.prototype.isUnspent = function(output, options, callback) {
};

AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var self = this;

  var txids = [];

  async.eachLimit(addresses, self.concurrency, function(address, next) {
    self.getAddressTxids(address, options, function(err, tmpTxids) {
      if(err) {
        return next(err);
      }

      txids = _.union(txids, tmpTxids);
      return next();
    });
  }, function() {
    async.mapLimit(txids, self.concurrency, function(txid, next) {
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

AddressService.prototype.getAddressTxidsWithHeights = function(address, options, callback) {
  var self = this;

  var opts = options || {};
  var txids = {};

  var start = self._encoding.encodeAddressIndexKey(address, opts.start || 0); //the start and end must be the same length
  var end = Buffer.concat([ start.slice(0, -36), new Buffer((opts.end || 'ffffffff'), 'hex') ]);

  var stream = self.db.createKeyStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(buffer) {
    var key = self._encoding.decodeAddressIndexKey(buffer);
    assert(key.txid.length === 64, 'AddressService, Txid: ' + key.txid + ' with length: ' + key.txid.length + ' does not resemble a txid.');
    txids[key.txid] = key.height;
  });

  stream.on('end', function() {
    callback(streamErr, txids);
  });

  stream.on('error', function(err) {
    streamErr = err;
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


module.exports = AddressService;
