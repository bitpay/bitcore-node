'use strict';

var BitcoreHTTP = require('../lib/http');
var bitcore = require('bitcore');
var request = require('supertest');

var _agent = null;
module.exports = function(nodeMock) {
  if (process.env.INTEGRATION === 'true') {
    if (_agent) {
      return _agent;
    }
    var config = require('config');
    var network = config.get('BitcoreHTTP.BitcoreNode').network;
    console.log('Starting test suite', network, 'network');
    bitcore.Networks.defaultNetwork = bitcore.Networks.get(network);
    var node = BitcoreHTTP.create(config.get('BitcoreHTTP'));
    node.start();
    _agent = request(node.app);
    return _agent;
  }
  return request(new BitcoreHTTP(nodeMock).app);
};
