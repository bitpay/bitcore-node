'use strict';

var RpcClient = require('bitcoind-rpc');
var util = require('util');

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var Transaction = bitcore.Transaction;

var BitcoindRpc = function(eventBus, client) {
  $.checkArgument(eventBus);
  $.checkArgument(client);
  this.bus = eventBus;
  this.client = client;
};

BitcoindRpc.create = function(eventBus, opts) {
  opts = opts || {};
  var client = new RpcClient({
    protocol: opts.protocol || 'http',
    host: opts.host || 'localhost',
    port: opts.port || 8332,
    user: opts.user || 'user',
    pass: opts.password || 'pass'
  });
  return new BitcoindRpc(eventBus, client);
};

BitcoindRpc.prototype._emitMemoryPool = function() {
  var self = this;
  self.client.getRawMemPool(function(err, ret) {
    if (!err) {
      ret.result.map(function(txId){
        self.getTx(txId, function (err, ret) {
          if (!err) {
            self.bus.process(ret);
          }
        });
      });
    }
  });
};

BitcoindRpc.prototype.getTx = function(txId, callback) {
  this.client.getRawTransaction(txId, function (err, ret) {
    if (err) {
      callback(err);
    }
    else {
      var tx = new Transaction();
      tx.fromString(ret.result);
      callback(null, tx)
    }
  })
};

module.exports = BitcoindRpc;
