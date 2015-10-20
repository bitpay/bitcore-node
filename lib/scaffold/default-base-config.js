'use strict';

var path = require('path');

/**
 * Will return the path and default bitcore-node configuration on environment variables
 * or default locations.
 */
function getDefaultBaseConfig() {
  return {
    path: process.cwd(),
    config: {
      datadir: path.resolve(process.env.HOME, '.bitcoin'),
      network: 'livenet',
      port: 3001,
      services: ['bitcoind', 'db', 'address', 'web']
    }
  };
}

module.exports = getDefaultBaseConfig;
