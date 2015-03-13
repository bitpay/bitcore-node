'use strict';

var BitcoreHTTP = require('../lib/http');

var get_app = function(nodeMock) {
  return process.env.INTEGRATION === 'true' ? BitcoreHTTP.create().app : new BitcoreHTTP(nodeMock).app;
};

module.exports = get_app;
