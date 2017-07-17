'use strict';
var BaseService = require('../../service');
var util = require('util');
var Encoding = require('./encoding');
var index = require('../../index');
var log = index.log;

var MempoolService = function(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._tx = this.node.services.transaction;
};

util.inherits(MempoolService, BaseService);

MempoolService.dependencies = ['db'];

MempoolService.prototype.getAPIMethods = function() {
  var methods = [
   ['getTransaction', this, this.getTransaction, 1]
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

MempoolService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('p2p/block', this._onBlock.bind(this));
  this._bus.on('p2p/transaction', this._onTransaction.bind(this));

  this._bus.subscribe('p2p/block');
  this._bus.subscribe('p2p/transaction');
};

MempoolService.prototype._onBlock = function(block) {
  // remove this block's txs from mempool
  var ops = block.transactions.map(function(tx) {
    return {
      type: 'del',
      key: tx.id
    };
  });
  this._db.batch(ops);
};

MempoolService.prototype._onTransaction = function(tx) {
  var txOps = this._getTxOperation(tx);
  this._db.batch(txOps);
};

MempoolService.prototype._getTxOperations = function(tx) {
  var inputValues = this._tx.getInputValues(tx);
  tx.__inputValues = inputValues;
  return {
    type: 'put',
    key: this._encoding.encodeMempoolTransactionKey(tx.id),
    value: this._encoding.encodeMempoolTransactionValue(tx)
  };
};

MempoolService.prototype.getTransaction = function(txid, callback) {
  this._db.get(this._encoding.encodeMempoolTransactionKey(txid), callback);
};

MempoolService.prototype.stop = function(callback) {
  callback();
};


module.exports = MempoolService;

