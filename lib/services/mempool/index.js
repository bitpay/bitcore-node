'use strict';
var BaseService = require('../../service');
var util = require('util');
var Encoding = require('./encoding');
var log = require('../..').log;
var utils = require('../../utils');

var MempoolService = function(options) {
  BaseService.call(this, options);
  this._subscriptions = {};
  this._subscriptions.transaction = [];
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._network = this.node.network;
  this._flush = options.flush;
  this._enabled = false;

  if (this._network === 'livenet') {
    this._network = 'main';
  }
  if (this._network === 'regtest') {
    this._network = 'testnet';
  }
};

util.inherits(MempoolService, BaseService);

MempoolService.dependencies = ['db'];

MempoolService.prototype.getAPIMethods = function() {
  var methods = [
    ['getMempoolTransaction', this, this.getMempoolTransaction, 1],
    ['getTxsByAddress', this, this.getTxsByAddress, 2],
  ];
  return methods;
};

MempoolService.prototype.start = function(callback) {
  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }
    self._encoding = new Encoding(prefix);
    self._startSubscriptions();

    if (self._flush) {
      return self._flushMempool(callback);
    }
    callback();
  });
};

MempoolService.prototype._flushMempool = function(callback) {
  var self = this;

  log.warn('Mempool Service: flushing mempool, this could take a minute.');
  // TODO: just handle the txindex for now, later handle both txindex and addressindex
  // TODO: plan a migration system for upgrades to the indexes
  var ops = [];

  var criteria = {
    gte: Buffer.concat([ self._encoding.servicePrefix, new Buffer(new Array(65).join('0'), 'hex')]),
    lt: Buffer.concat([ self._encoding.servicePrefix, new Buffer(new Array(65).join('f'), 'hex')])
  };

  var stream = self._db.createKeyStream(criteria);

  stream.on('data', function(key) {
    ops.push({
      type: 'del',
      key: key
    });
  });

  stream.on('end', function() {
    self._db.batch(ops, function(err) {
      if (err) {
        return callback(err);
      }
      log.info('Mempool Service: completed flushing: ' + ops.length + ' mempool records.');
      callback();
    });
  });

};

MempoolService.prototype.onReorg = function(args, callback) {

  var removalOps = [];

  if (!this._enabled) {
    return callback(null, removalOps);
  }

  var oldBlockList = args[1];

  for(var i = 0; i < oldBlockList.length; i++) {

    var block = oldBlockList[i];

    for(var j = 0; j < block.txs.length; j++) {

      var tx = block.txs[j];
      var key = this._encoding.encodeMempoolTransactionKey(tx.txid());
      var value = this._encoding.encodeMempoolTransactionValue(tx);

      removalOps.push({
        type: 'put',
        key: key,
        value: value
      });

      removalOps = removalOps.concat(this._getAddressOperations(tx, true));

    }
  }

  setImmediate(function() {
    callback(null, removalOps);
  });
};

MempoolService.prototype._startSubscriptions = function() {

  var self = this;
  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  if (!self._bus) {
    self._bus = self.node.openBus({remoteAddress: 'localhost-mempool'});
  }

  self._bus.on('p2p/transaction', self._onTransaction.bind(self));
  self._bus.subscribe('p2p/transaction');

  self._p2p.on('bestHeight', function() {
    log.info('Mempool Service: Geting mempool from peer.');
    self._p2p.getMempool();
  });

};

MempoolService.prototype.enable = function() {
  this._enabled = true;
};

MempoolService.prototype.onBlock = function(block, callback) {

  // remove this block's txs from mempool
  var self = this;
  var ops = [];

  if (!self._enabled) {
    return callback(null, ops);
  }

  for(var i = 0; i < block.txs.length; i++) {
    var tx = block.txs[i];

    // tx index
    ops.push({
      type: 'del',
      key: self._encoding.encodeMempoolTransactionKey(tx.txid())
    });

    // address index
    ops = ops.concat(self._getAddressOperations(tx));

  }

  callback(null, ops);

};

MempoolService.prototype._getAddressOperations = function(tx, reverse) {

  var ops = [];
  var address;

  var action = reverse ? 'put' : 'del';

  for(var i = 0; i < tx.outputs.length; i++) {

    var output = tx.outputs[i];
    address = utils.getAddress(output, this._network);

    if (!address) {
      continue;
    }

    ops.push({
      type: action,
      key: this._encoding.encodeMempoolAddressKey(address, tx.txid(), i, 0),
      value: this._encoding.encodeMempoolAddressValue(tx)
    });
  }

  for(i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    address = utils.getAddress(input, this._network);

    if (!address) {
      continue;
    }

    ops.push({
      type: action,
      key: this._encoding.encodeMempoolAddressKey(address, tx.txid(), i, 1),
      value: this._encoding.encodeMempoolAddressValue(tx)
    });
  }

  return ops;


};

MempoolService.prototype._onTransaction = function(tx) {

  var self = this;
  var ops = [{
      type: 'put',
      key: self._encoding.encodeMempoolTransactionKey(tx.txid()),
      value: self._encoding.encodeMempoolTransactionValue(tx)
  }];

  ops.concat(self._getAddressOperations(tx, true));
  self._db.batch(ops, function(err) {
    if(err) {
      log.error(err);
      self.node.stop();
    }
  });

};

MempoolService.prototype.getMempoolTransaction = function(txid, callback) {

  var self = this;

  self._db.get(self._encoding.encodeMempoolTransactionKey(txid), function(err, tx) {

    if (err) {
      return callback(err);
    }

    if (!tx) {
      return callback();
    }

    callback(null, self._encoding.decodeMempoolTransactionValue(tx));

  });

};

MempoolService.prototype.getTxsByAddress = function(address, type, callback) {

  var self = this;
  var results = [];
  var start = self._encoding.encodeMempoolAddressKey(address);
  var end = Buffer.concat([ start.slice(0, -37), new Buffer(new Array(75).join('f'), 'hex') ]);

  var criteria = {
    gte: start,
    lte: end
  };

  var stream = self._db.createReadStream(criteria);

  stream.on('error', function() {
    return [];
  });

  stream.on('end', function() {
    callback(null, results);
  });

  stream.on('data', function(data) {
    var addressInfo = self._encoding.decodeMempoolAddressKey(data.key);
    if (type === 'input') {
      type = 1;
    } else if (type === 'output') {
      type = 0;
    }
    if (type === 'both' || type === addressInfo.input) {
      results.push(self._encoding.decodeMempoolAddressValue(data.value));
    }
  });

};

MempoolService.prototype.stop = function(callback) {
  callback();
};

module.exports = MempoolService;
