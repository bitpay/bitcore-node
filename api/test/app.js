'use strict';

var BitcoreHTTP = require('../lib/http');
var bitcore = require('bitcore');

var _app = null;
module.exports = function(nodeMock) {
  if (process.env.INTEGRATION === 'true') {
    if (_app) {
      return _app;
    }
    var config = require('config');
    var network = config.get('BitcoreHTTP.BitcoreNode').network;
    console.log('Starting test suite', network, 'network');
    bitcore.Networks.defaultNetwork = bitcore.Networks.get(network);
    _app = BitcoreHTTP.create(config.get('BitcoreHTTP')).app;
    return _app;
  }
  return new BitcoreHTTP(nodeMock).app;
};
