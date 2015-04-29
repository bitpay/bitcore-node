'use strict';

var BitcoreHTTP = require('./lib/http');
var bitcore = require('bitcore');

if (require.main === module) {
  var config = require('config');
  var network = config.get('BitcoreHTTP.BitcoreNode').network;
  console.log('Starting bitcore-node-http', network, 'network');
  bitcore.Networks.defaultNetwork = bitcore.Networks.get(network);
  var http = BitcoreHTTP.create(config.get('BitcoreHTTP'));
  http.start()
    .catch(function(err) {
      http.stop();
      throw err;
    });
}

module.exports = BitcoreHTTP;
