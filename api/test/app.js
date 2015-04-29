'use strict';

var BitcoreHTTP = require('../lib/http');
var bitcore = require('bitcore');

module.exports = function(nodeMock) {
  if (process.env.INTEGRATION === 'true') {
    var config = require('config');
    var network = config.get('BitcoreHTTP.BitcoreNode').network;
    console.log('Starting test suite', network, 'network');
    bitcore.Networks.defaultNetwork = bitcore.Networks.get(network);
    return BitcoreHTTP.create(config.get('BitcoreHTTP')).app;
  }
  return new BitcoreHTTP(nodeMock).app;
};
