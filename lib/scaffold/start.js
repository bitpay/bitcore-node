'use strict';

var path = require('path');
var BitcoreNode = require('../node');
var index = require('../');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var log = index.log;
log.debug = function() {};

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
 * @param {Object} config
 * @param {Array} config.services - An array of strings of service names.
 * @returns {Array}
 */
function setupServices(req, config) {
  var services = [];
  if (config.services) {
    for (var i = 0; i < config.services.length; i++) {
      var service = {};
      service.name = config.services[i];

      var hasConfig = config.servicesConfig && config.servicesConfig[service.name];
      service.config = hasConfig ? config.servicesConfig[service.name] : {};

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

      // check that the service supports expected methods
      if (!service.module.prototype ||
          !service.module.dependencies ||
          !service.module.prototype.start ||
          !service.module.prototype.stop) {
        throw new Error(
          'Could not load service "' + service.name + '" as it does not support necessary methods.'
        );
      }

      services.push(service);
    }
  }
  return services;
}

/**
 * Will register event handlers to log the current db sync status.
 * @param {Node} node
 */
function registerSyncHandlers(node, delay) {

  delay = delay || 10000;
  var interval = false;
  var count = 0;

  function logSyncStatus() {
    log.info(
      'Sync Status: Tip:', node.services.db.tip.hash,
      'Height:', node.services.db.tip.__height,
      'Rate:', count/10, 'blocks per second'
    );
  }

  node.on('synced', function() {
    clearInterval(interval);
  });

  node.on('ready', function() {
    node.services.db.on('addblock', function(block) {
      count++;
      // Initialize logging if not already instantiated
      if (!interval) {
        interval = setInterval(function() {
          logSyncStatus();
          count = 0;
        }, delay);
      }
    });
  });

  node.on('stopping', function() {
    clearInterval(interval);
  });
}

/**
 * Will register event handlers to stop the node for `process` events
 * `uncaughtException` and `SIGINT`.
 * @param {Node} proc - The Node.js process
 * @param {Node} node
 */
function registerExitHandlers(proc, node) {

  function exitHandler(options, err) {
    if (err) {
      log.error('uncaught exception:', err);
      if(err.stack) {
        log.error(err.stack);
      }
      node.stop(function(err) {
        if(err) {
          log.error('Failed to stop services: ' + err);
        }
        proc.exit(-1);
      });
    }
    if (options.sigint) {
      node.stop(function(err) {
        if(err) {
          log.error('Failed to stop services: ' + err);
          return proc.exit(1);
        }

        log.info('Halted');
        proc.exit(0);
      });
    }
  }

  //catches uncaught exceptions
  proc.on('uncaughtException', exitHandler.bind(null, {exit:true}));

  //catches ctrl+c event
  proc.on('SIGINT', exitHandler.bind(null, {sigint:true}));
}

/**
 * This function will instantiate and start a Node, requiring the necessary service
 * modules, and registering event handlers.
 * @param {Object} options
 * @param {String} options.path - The absolute path of the configuration file
 * @param {Object} options.config - The parsed bitcore-node.json configuration file
 * @param {Array}  options.config.services - An array of services names.
 * @param {Object} options.config.servicesConfig - Parameters to pass to each service
 * @param {String} options.config.datadir - A relative (to options.path) or absolute path to the datadir
 * @param {String} options.config.network - 'livenet', 'testnet' or 'regtest
 * @param {Number} options.config.port - The port to use for the web service
 */
function start(options) {

  var fullConfig = _.clone(options.config);
  fullConfig.services = setupServices(require, options.config);
  fullConfig.datadir = path.resolve(options.path, options.config.datadir);

  var node = new BitcoreNode(fullConfig);

  // set up the event handlers for logging sync information
  registerSyncHandlers(node);

  // setup handlers for uncaught exceptions and ctrl+c
  registerExitHandlers(process, node);

  node.on('ready', function() {
    log.info('Bitcore Node ready');
  });

  node.on('error', function(err) {
    log.error(err);
  });

  return node;

}

module.exports = start;
module.exports.registerExitHandlers = registerExitHandlers;
module.exports.registerSyncHandlers = registerSyncHandlers;
module.exports.setupServices = setupServices;
