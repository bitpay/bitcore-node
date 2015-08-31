'use strict';

var path = require('path');
var socketio = require('socket.io');
var BitcoreNode = require('../node');
var index = require('../');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
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
      var service = {};
      if(typeof config.services[i] === 'object') {
        $.checkState(config.services[i].name, 'Service name must be specified in config');
        service.name = config.services[i].name;
        service.config = config.services[i].config || {};
      } else {
        service.name = config.services[i];
        service.config = {};
      }

      try {
        // first try in the built-in bitcore-node services directory
        service.module = require(path.resolve(__dirname, '../services/' + service.name));
      } catch(e) {

        // check if the package.json specifies a specific file to use
        var servicePackage = require(service.name + '/package.json');
        var serviceModule = service.name;
        if (servicePackage.bitcoreNode) {
          serviceModule = service.name + '/' + servicePackage.bitcoreNode;
        }
        service.module = require(serviceModule);
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

      service.dependencies = service.module.dependencies;
      services.push(service);
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
