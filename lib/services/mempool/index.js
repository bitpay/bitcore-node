'use strict';
var BaseService = require('../../service');
var util = require('util');
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;

var MempoolService = function(options) {
  BaseService.call(this, options);
  this._subscriptions = {};
  this._subscriptions.transaction = [];
  this._db = this.node.services.db;
};

util.inherits(MempoolService, BaseService);

MempoolService.dependencies = ['db'];

MempoolService.prototype.getAPIMethods = function() {
  var methods = [
   ['getMempoolTransaction', this, this.getMempoolTransaction, 1]
  ];
  return methods;
};

MempoolService.prototype.getPublishEvents = function() {

  return [
    {
      name: 'mempool/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    }
  ];

};

MempoolService.prototype.subscribe = function(name, emitter) {

  this._subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'mempool/' + name, 'total:', this._subscriptions[name].length);

};

MempoolService.prototype.unsubscribe = function(name, emitter) {

  var index = this._subscriptions[name].indexOf(emitter);

  if (index > -1) {
    this._subscriptions[name].splice(index, 1);
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'mempool/' + name, 'total:', this._subscriptions[name].length);

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

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost-mempool'});
  }

  this._bus.on('p2p/transaction', this._onTransaction.bind(this));
  this._bus.subscribe('p2p/transaction');
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

MempoolService.prototype.stop = function(callback) {
  callback();
};

module.exports = MempoolService;
