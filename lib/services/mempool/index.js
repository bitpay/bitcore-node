'use strict';
var BaseService = require('../../service');
var util = require('util');
var Encoding = require('./encoding');
var log = require('../..').log;

var MempoolService = function(options) {
  BaseService.call(this, options);
  this._subscriptions = {};
  this._subscriptions.transaction = [];
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._network = this.node.network;

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
    ['getTxidsByAddress', this, this.getTxidsByAddress, 1],
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

    callback();
  });
};

MempoolService.prototype.onReorg = function(args, callback) {

  var oldBlockList = args[1];

  var removalOps = [];

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

MempoolService.prototype.onBlock = function(block, callback) {

  // remove this block's txs from mempool
  var self = this;
  var ops = block.txs.map(function(tx) {
    return {
      type: 'del',
      key: self._encoding.encodeMempoolTransactionKey(tx.txid())
    };
  });
  callback(null, ops);

};

MempoolService.prototype._onTransaction = function(tx) {
  this._db.put(this._encoding.encodeMempoolTransactionKey(tx.txid()),
    this._encoding.encodeMempoolTransactionValue(tx));
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

MempoolService.prototype.getTxidsByAddress = function(address, callback) {
  // given an address, give me all the tx ids for txs that involve this address
  // perceivably, our mempool will remain a managable size, so cycling over the whole
  // pool won't be too spendy?
  var self = this;
  var results = [];
  var start = self._encoding.encodeMempoolTransactionKey(new Array(65).join('0'));
  var end = self._encoding.encodeMempoolTransactionKey(new Array(65).join('f'));

  var criteria = {
    gte: start,
    lte: end
  };

  var stream = self._db.createReadStream(criteria);

  stream.on('end', function() {
    return callback(null, results);
  });

  stream.on('data', function(data) {
    var tx = self._encoding.decodeMempoolTransactionValue(data.value);
    var txid = self._involvesAddress(tx, address);
    if (txid) {
      results.push(txid);
    }
  });

};

MempoolService.prototype._involvesAddress = function(tx, address) {

  var _address;
  for(var i = 0; i < tx.inputs.length; i++) {
    var input = tx.inputs[i];
    _address = input.getAddress();
    if (!_address) {
      continue;
    }
    _address.network = this._network;
    _address = _address.toString();
    if (address === _address) {
      return tx.txid();
    }
  }

  for(i = 0; i < tx.outputs.length; i++) {
    var output = tx.outputs[i];
    _address = output.getAddress();
    if (!_address) {
      continue;
    }
    _address.network = this._network;
    _address = _address.toString();
    if (address === _address) {
      return tx.txid();
    }
  }

};

MempoolService.prototype.stop = function(callback) {
  callback();
};

module.exports = MempoolService;
