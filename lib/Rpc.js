'use strict';

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var RpcClient       = require('bitcoind-rpc');
var util            = require('util');

var BitcoindRpc = function(eventBus, client) {
  $.checkArgument(eventBus);
  $.checkArgument(client);
};

BitcoindRpc.create = function(eventBus, opts) {
  opts = opts || {};
  var client = new RpcClient({
    protocol: 'http',
    host: opts.host || 'localhost',
    port: opts.port || 8332,
    user: opts.user || 'user',
    pass: opts.password || 'pass'
  });
  return new BitcoindRpc(eventBus, client);
};

module.exports = BitcoindRpc;
