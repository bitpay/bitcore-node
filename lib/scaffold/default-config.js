var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var package = require('../../package');

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

  if (fs.existsSync(defaultConfigFile)) {
    const currentConfig = require(defaultConfigFile);
    
    function getMajorVersion(versionString) {
      return parseInt(versionString.split('.')[0])
    }

    // config must have a `version` field with major equal to package major version
    if(currentConfig.version && getMajorVersion(package.version) === getMajorVersion(currentConfig.version)) {
      return {
        path: defaultPath,
        config: config
      };
    }

    console.log(`The configuration file at '${defaultConfigFile}' is incompatible with this version of Bitcore.`);

    const now = new Date();
    // bitcore-node.YYYY-MM-DD.UnixTimestamp.json
    const backupFileName = `bitcore-node.${now.getUTCFullYear() + '-' + now.getUTCMonth() + '-' + now.getUTCDate() + '.' + now.getTime()}.json`;
    const backupFile = path.resolve(defaultPath, backupFileName);
    fs.renameSync(defaultConfigFile, backupFile);
    console.log(`The previous configuration file has been moved to: ${backupFile}.`);
  }

  console.log(`Creating a new configuration file at: ${defaultConfigFile}.`);

  const defaultServices = [
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

  var defaultDataDir = path.resolve(defaultPath, './data');

  if (!fs.existsSync(defaultDataDir)) {
    mkdirp.sync(defaultDataDir);
  }

  var defaultConfig = {
    version: package.version,
    network: 'livenet',
    port: 3001,
    services: options.additionalServices ? defaultServices.concat(options.additionalServices) : defaultServices,
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

  var config = JSON.parse(fs.readFileSync(defaultConfigFile, 'utf-8'));

  return {
    path: defaultPath,
    config: config
  };

}

module.exports = getDefaultConfig;
