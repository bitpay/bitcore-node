'use strict';

var BitcoreHTTP = require('../lib/http');

module.exports = function(nodeMock) {
  return process.env.INTEGRATION === 'true' ? BitcoreHTTP.create().app : new BitcoreHTTP(nodeMock).app;
};
