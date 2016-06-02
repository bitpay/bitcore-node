'use strict';

var path = require('path');
var BitcoreNode = require('../node');
var index = require('../');
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var log = index.log;
var shuttingDown = false;

log.debug = function() {};

/**
 * Checks for configuration options from version 2. This includes an "address" and
 * "db" service, or having "datadir" at the root of the config.
 */
function checkConfigVersion2(fullConfig) {
  var datadirUndefined = _.isUndefined(fullConfig.datadir);
  var addressDefined = (fullConfig.services.indexOf('address') >= 0);
  var dbDefined = (fullConfig.services.indexOf('db') >= 0);

  if (!datadirUndefined || addressDefined || dbDefined) {

    console.warn('\nConfiguration file is not compatible with this version. \n' +
                 'A reindex for bitcoind is necessary for this upgrade with the "reindex=1" bitcoin.conf option. \n' +
                 'There are changes necessary in both bitcoin.conf and bitcore-node.json. \n\n' +
                 'To upgrade please see the details below and documentation at: \n' +
                 'https://github.com/bitpay/bitcore-node/blob/bitcoind/docs/upgrade.md \n');

    if (!datadirUndefined) {
      console.warn('Please remove "datadir" and add it to the config at ' + fullConfig.path + ' with:');
      var missingConfig = {
        servicesConfig: {
          bitcoind: {
            spawn: {
              datadir: fullConfig.datadir,
              exec: path.resolve(__dirname, '../../bin/bitcoind')
            }
          }
        }
      };
      console.warn(JSON.stringify(missingConfig, null, 2) + '\n');
    }

    if (addressDefined || dbDefined) {
      console.warn('Please remove "address" and/or "db" from "services" in: ' + fullConfig.path + '\n');
    }

    return true;
  }

  return false;
}

/**
 * This function will instantiate and start a Node, requiring the necessary service
 * modules, and registering event handlers.
 * @param {Object} options
 * @param {Object} options.servicesPath - The path to the location of service modules
 * @param {String} options.path - The absolute path of the configuration file
 * @param {Object} options.config - The parsed bitcore-node.json configuration file
 * @param {Array}  options.config.services - An array of services names.
 * @param {Object} options.config.servicesConfig - Parameters to pass to each service
 * @param {String} options.config.network - 'livenet', 'testnet' or 'regtest
 * @param {Number} options.config.port - The port to use for the web service
 */
function start(options) {
  /* jshint maxstatements: 20 */

  var fullConfig = _.clone(options.config);

  var servicesPath;
  if (options.servicesPath) {
    servicesPath = options.servicesPath; // services are in a different directory than the config
  } else {
    servicesPath = options.path; // defaults to the same directory
  }

  fullConfig.path = path.resolve(options.path, './bitcore-node.json');

  if (checkConfigVersion2(fullConfig)) {
    process.exit(1);
  }

  fullConfig.services = start.setupServices(require, servicesPath, options.config);

  var node = new BitcoreNode(fullConfig);

  // setup handlers for uncaught exceptions and ctrl+c
  start.registerExitHandlers(process, node);

  node.on('ready', function() {
    log.info('Bitcore Node ready');
  });

  node.on('error', function(err) {
    log.error(err);
  });

  node.start(function(err) {
    if(err) {
      log.error('Failed to start services');
      if (err.stack) {
        log.error(err.stack);
      }
      start.cleanShutdown(process, node);
    }
  });

  return node;

}

/**
 * Checks a service for the expected methods
 * @param {Object} service
 */
function checkService(service) {
  // check that the service supports expected methods
  if (!service.module.prototype ||
      !service.module.dependencies ||
      !service.module.prototype.start ||
      !service.module.prototype.stop) {
    throw new Error(
      'Could not load service "' + service.name + '" as it does not support necessary methods and properties.'
    );
  }
}

/**
 * Will require a module from local services directory first
 * and then from available node_modules
 * @param {Function} req
 * @param {Object} service
 */
function loadModule(req, service) {
  try {
    // first try in the built-in bitcore-node services directory
    service.module = req(path.resolve(__dirname, '../services/' + service.name));
  } catch(e) {

    // check if the package.json specifies a specific file to use
    var servicePackage = req(service.name + '/package.json');
    var serviceModule = service.name;
    if (servicePackage.bitcoreNode) {
      serviceModule = service.name + '/' + servicePackage.bitcoreNode;
    }
    service.module = req(serviceModule);
  }
}

/**
 * This function will loop over the configuration for services and require the
 * specified modules, and assemble an array in this format:
 * [
 *   {
 *     name: 'bitcoind',
 *     config: {},
 *     module: BitcoinService
 *   }
 * ]
 * @param {Function} req - The require function to use
 * @param {Array} servicesPath - The local path (for requiring services)
 * @param {Object} config
 * @param {Array} config.services - An array of strings of service names.
 * @returns {Array}
 */
function setupServices(req, servicesPath, config) {

  module.paths.push(path.resolve(servicesPath, './node_modules'));

  var services = [];
  if (config.services) {
    for (var i = 0; i < config.services.length; i++) {
      var service = {};
      service.name = config.services[i];

      var hasConfig = config.servicesConfig && config.servicesConfig[service.name];
      service.config = hasConfig ? config.servicesConfig[service.name] : {};

      loadModule(req, service);
      checkService(service);

      services.push(service);
    }
  }
  return services;
}

/**
 * Will shutdown a node and then the process
 * @param {Object} _process - The Node.js process object
 * @param {Node} node - The Bitcore Node instance
 */
function cleanShutdown(_process, node) {
  node.stop(function(err) {
    if(err) {
      log.error('Failed to stop services: ' + err);
      return _process.exit(1);
    }
    log.info('Halted');
    _process.exit(0);
  });
}

/**
 * Will handle all the shutdown tasks that need to take place to ensure a safe exit
 * @param {Object} options
 * @param {String} options.sigint - The signal given was a SIGINT
 * @param {Array}  options.exit - The signal given was an uncaughtException
 * @param {Object} _process - The Node.js process
 * @param {Node} node
 * @param {Error} error
*/
function exitHandler(options, _process, node, err) {
  if (err) {
    log.error('uncaught exception:', err);
    if(err.stack) {
      log.error(err.stack);
    }
    node.stop(function(err) {
      if(err) {
        log.error('Failed to stop services: ' + err);
      }
      _process.exit(-1);
    });
  }
  if (options.sigint) {
    if (!shuttingDown) {
      shuttingDown = true;
      start.cleanShutdown(_process, node);
    }
  }
}

/**
 * Will register event handlers to stop the node for `process` events
 * `uncaughtException` and `SIGINT`.
 * @param {Object} _process - The Node.js process
 * @param {Node} node
 */
function registerExitHandlers(_process, node) {
  //catches uncaught exceptions
  _process.on('uncaughtException', exitHandler.bind(null, {exit:true}, _process, node));

  //catches ctrl+c event
  _process.on('SIGINT', exitHandler.bind(null, {sigint:true}, _process, node));
}

module.exports = start;
module.exports.registerExitHandlers = registerExitHandlers;
module.exports.exitHandler = exitHandler;
module.exports.setupServices = setupServices;
module.exports.cleanShutdown = cleanShutdown;
module.exports.checkConfigVersion2 = checkConfigVersion2;
