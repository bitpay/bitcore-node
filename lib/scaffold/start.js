'use strict';

var path = require('path');
var socketio = require('socket.io');
var BitcoreNode = require('../node');
var index = require('../');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var log = index.log;
log.debug = function() {};

var count = 0;
var interval = false;

function start(options) {
  /* jshint maxstatements: 100 */

  var services = [];

  var configPath = options.path;
  var config = options.config;

  if (config.services) {
    for (var i = 0; i < config.services.length; i++) {
      var serviceName = config.services[i];
      var service;
      try {
        // first try in the built-in bitcore-node services directory
        service = require(path.resolve(__dirname, '../services/' + serviceName));
      } catch(e) {

        // check if the package.json specifies a specific file to use
        var servicePackage = require(serviceName + '/package.json');
        var serviceModule = serviceName;
        if (servicePackage.bitcoreNode) {
          serviceModule = serviceName + '/' + servicePackage.bitcoreNode;
        }
        service = require(serviceModule);
      }

      // check that the service supports expected methods
      if (!service.prototype ||
          !service.dependencies ||
          !service.prototype.start ||
          !service.prototype.stop) {
        throw new Error(
          'Could not load service "' + serviceName + '" as it does not support necessary methods.'
        );
      }
      services.push({
        name: serviceName,
        module: service,
        dependencies: service.dependencies
      });

    }
  }

  var fullConfig = _.clone(config);

  // expand to the full path
  fullConfig.datadir = path.resolve(configPath, config.datadir);

  // load the services
  fullConfig.services = services;

  var node = new BitcoreNode(fullConfig);

  function logSyncStatus() {
    log.info(
      'Sync Status: Tip:', node.services.db.tip.hash,
      'Height:', node.services.db.tip.__height,
      'Rate:', count/10, 'blocks per second'
    );
  }

  node.on('synced', function() {
    // Stop logging of sync status
    clearInterval(interval);
    interval = false;
    logSyncStatus();
  });

  node.on('ready', function() {
    log.info('Bitcore Node ready');
  });

  node.on('error', function(err) {
    log.error(err);
  });

  node.on('ready', function() {
    node.services.db.on('addblock', function(block) {
      count++;
      // Initialize logging if not already instantiated
      if (!interval) {
        interval = setInterval(function() {
          logSyncStatus();
          count = 0;
        }, 10000);
      }
    });
  });

  node.on('stopping', function() {
    clearInterval(interval);
  });

  function exitHandler(options, err) {
    if (err) {
      log.error('uncaught exception:', err);
      if(err.stack) {
        console.log(err.stack);
      }
      node.stop(function(err) {
        if(err) {
          log.error('Failed to stop services: ' + err);
        }
        process.exit(-1);
      });
    }
    if (options.sigint) {
      node.stop(function(err) {
        if(err) {
          log.error('Failed to stop services: ' + err);
          return process.exit(1);
        }

        log.info('Halted');
        process.exit(0);
      });
    }
  }

  //catches uncaught exceptions
  process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

  //catches ctrl+c event
  process.on('SIGINT', exitHandler.bind(null, {sigint:true}));

  return node;

}

module.exports = start;
