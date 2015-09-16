'use strict';

var path = require('path');
var BitcoreNode = require('../node');
var index = require('../');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var log = index.log;
var child_process = require('child_process');
var fs = require('fs');
var shuttingDown = false;

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
 * @param {Array} cwd - The local path (for requiring services)
 * @param {Object} config
 * @param {Array} config.services - An array of strings of service names.
 * @returns {Array}
 */
function setupServices(req, cwd, config) {

  module.paths.push(path.resolve(cwd, './node_modules'));

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
      'Database Sync Status: Tip:', node.services.db.tip.hash,
      'Height:', node.services.db.tip.__height,
      'Rate:', count/10, 'blocks per second'
    );
  }

  node.on('ready', function() {

    if (node.services.db) {
      node.on('synced', function() {
        clearInterval(interval);
        logSyncStatus();
      });
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
    }

  });

  node.on('stopping', function() {
    clearInterval(interval);
  });
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
  fullConfig.services = start.setupServices(require, options.path, options.config);
  fullConfig.datadir = path.resolve(options.path, options.config.datadir);

  if (fullConfig.daemon) {
    start.spawnChildProcess(fullConfig.datadir, process);
  }

  var node = new BitcoreNode(fullConfig);

  // set up the event handlers for logging sync information
  start.registerSyncHandlers(node);

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
 * This function will fork the passed in process and exit the parent process
 * in order to daemonize the process. If there is already a daemon for this pid (process),
 * then the function just returns. Stdout and stderr both append to one file, 'bitcore-node.log'
 * located in the datadir.
 * @param {String} datadir - The data directory where the bitcoin blockchain and config live.
 * @param {Object} _process - The process that needs to fork a child and then, itself, exit.
 */
function spawnChildProcess(datadir, _process) {

  if (_process.env.__bitcore_node) {
    return _process.pid;
  }

  var args = [].concat(_process.argv);
  args.shift();
  var script = args.shift();
  var env = _process.env;
  var cwd = _process.cwd();
  env.__bitcore_node = true;

  var stderr = fs.openSync(datadir + '/bitcore-node.log', 'a+');
  var stdout = stderr;

  var cp_opt = {
    stdio: ['ignore', stdout, stderr],
    env: env,
    cwd: cwd,
    detached: true
  };

  var child = child_process.spawn(_process.execPath, [script].concat(args), cp_opt);
  child.unref();
  return _process.exit();
}

module.exports = start;
module.exports.registerExitHandlers = registerExitHandlers;
module.exports.exitHandler = exitHandler;
module.exports.registerSyncHandlers = registerSyncHandlers;
module.exports.setupServices = setupServices;
module.exports.spawnChildProcess = spawnChildProcess;
module.exports.cleanShutdown = cleanShutdown;
