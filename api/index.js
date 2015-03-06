'use strict';

var BitcoreHTTP = require('./lib/http');

if (require.main === module) {
  var config = require('config');
  var http = BitcoreHTTP.create(config.get('BitcoreHTTP'));
  http.start();
}

module.exports = BitcoreHTTP;
