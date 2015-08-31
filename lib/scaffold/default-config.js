'use strict';

var path = require('path');

/**
 * Will return the path and default bitcore-node configuration on environment variables
 * or default locations.
 */
function getDefaultConfig() {
  return {
    path: process.cwd(),
    config: {
      datadir: process.env.BITCORENODE_DIR || path.resolve(process.env.HOME, '.bitcoin'),
      network: process.env.BITCORENODE_NETWORK || 'livenet',
      port: Number(process.env.BITCORENODE_PORT) || 3001,
      services: ['bitcoind', 'db', 'address', 'web']
    }
  };
}

module.exports = getDefaultConfig;
