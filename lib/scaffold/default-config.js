'use strict';

var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');

/**
 * Will return the path and default bitcore-node configuration. It will search for the
 * configuration file in the "~/.bitcore" directory, and if it doesn't exist, it will create one
 * based on default settings.
 * @param {Object} [options]
 * @param {Array} [options.additionalServices] - An optional array of services.
 */
function getDefaultConfig(options) {
  /* jshint maxstatements: 40 */
  if (!options) {
    options = {};
  }

  var defaultPath = path.resolve(process.env.HOME, './.bitcore');
  var defaultConfigFile = path.resolve(defaultPath, './bitcore-node.json');

  if (!fs.existsSync(defaultPath)) {
    mkdirp.sync(defaultPath);
  }

  var defaultServices = [
    'address',
    'block',
    'db',
    'fee',
    'header',
    'mempool',
    'p2p',
    'timestamp',
    'transaction',
    'web'
  ];

  if (options.additionalServices) {
    defaultServices = defaultServices.concat(options.additionalServices);
  }

  var defaultDataDir = path.resolve(defaultPath, './data');

  if (!fs.existsSync(defaultDataDir)) {
    mkdirp.sync(defaultDataDir);
  }

  if (!fs.existsSync(defaultConfigFile)) {
    var defaultConfig = {
      network: 'testnet',
      port: 3001,
      services: defaultServices,
      datadir: defaultDataDir,
      servicesConfig: {
        'insight-api': {
          cwdRequirePath: 'node_modules/insight-api'
        },
        'insight-ui': {
          cwdRequirePath: 'node_modules/insight-ui'
        }
      }
    };
    fs.writeFileSync(defaultConfigFile, JSON.stringify(defaultConfig, null, 2));
  }

  var config = JSON.parse(fs.readFileSync(defaultConfigFile, 'utf-8'));

  return {
    path: defaultPath,
    config: config
  };

}

module.exports = getDefaultConfig;
