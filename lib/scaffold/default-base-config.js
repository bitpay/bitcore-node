'use strict';

var path = require('path');

/**
 * Will return the path and default bitcore-node configuration on environment variables
 * or default locations.
 * @param {Object} options
 * @param {String} options.network - "testnet" or "livenet"
 */
function getDefaultBaseConfig(options) {
  if (!options) {
    options = {};
  }
  return {
    path: process.cwd(),
    config: {
      datadir: options.datadir || path.resolve(process.env.HOME, '.bitcoin'),
      network: options.network || 'livenet',
      port: 3001,
      services: ['bitcoind', 'db', 'address', 'web']
    }
  };
}

module.exports = getDefaultBaseConfig;
