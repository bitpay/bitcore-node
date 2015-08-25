'use strict';

var path = require('path');
var socketio = require('socket.io');
var BitcoreNode = require('../node');
var chainlib = require('chainlib');
var bitcore = require('bitcore');
var _ = bitcore.deps._;
var log = chainlib.log;
log.debug = function() {};

var count = 0;
var interval = false;

function start(options) {
  /* jshint maxstatements: 100 */

  var bitcoreModules = [];

  var configPath = options.path;
  var config = options.config;

  if (config.modules) {
    for (var i = 0; i < config.modules.length; i++) {
      var moduleName = config.modules[i];
      var bitcoreModule;
      try {
        // first try in the built-in bitcore-node modules directory
        bitcoreModule = require(path.resolve(__dirname, '../modules/' + moduleName));
      } catch(e) {

        // check if the package.json specifies a specific file to use
        var modulePackage = require(moduleName + '/package.json');
        var bitcoreNodeModule = moduleName;
        if (modulePackage.bitcoreNode) {
          bitcoreNodeModule = moduleName + '/' + modulePackage.bitcoreNode;
        }
        bitcoreModule = require(bitcoreNodeModule);

      }

      // check that the module supports expected methods
      if (!bitcoreModule.prototype ||
          !bitcoreModule.prototype.start ||
          !bitcoreModule.prototype.stop) {
        throw new Error(
          'Could not load module "' + moduleName + '" as it does not support necessary methods.'
        );
      }
      bitcoreModules.push(bitcoreModule);
    }
  }

  var fullConfig = _.clone(config);

  // expand to the full path
  fullConfig.datadir = path.resolve(configPath, config.datadir);

  // delete until modules move to the node
  delete fullConfig.modules;

  // load the modules
  fullConfig.db = {
    modules: bitcoreModules
  };

  var node = new BitcoreNode(fullConfig);

  function logSyncStatus() {
    log.info(
      'Sync Status: Tip:', node.chain.tip.hash,
      'Height:', node.chain.tip.__height,
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

    var io = socketio(fullConfig.port);

    io.on('connection', function(socket) {

      var bus = node.openBus();

      var methods = node.getAllAPIMethods();
      var methodsMap = {};

      methods.forEach(function(data) {
        var name = data[0];
        var instance = data[1];
        var method = data[2];
        var args = data[3];
        methodsMap[name] = {
          fn: function() {
            return method.apply(instance, arguments);
          },
          args: args
        };
      });

      socket.on('message', function(message, socketCallback) {
        if (methodsMap[message.method]) {
          var params = message.params;

          if(!params || !params.length) {
            params = [];
          }

          if(params.length !== methodsMap[message.method].args) {
            return socketCallback({
              error: {
                message: 'Expected ' + methodsMap[message.method].args + ' parameters'
              }
            });
          }

          var callback = function(err, result) {
            var response = {};
            if(err) {
              response.error = {
                message: err.toString()
              };
            }

            if(result) {
              response.result = result;
            }

            socketCallback(response);
          };

          params = params.concat(callback);
          methodsMap[message.method].fn.apply(this, params);
        } else {
          socketCallback({
            error: {
              message: 'Method Not Found'
            }
          });
        }
      });

      socket.on('subscribe', function(name, params) {
        bus.subscribe(name, params);
      });

      socket.on('unsubscribe', function(name, params) {
        bus.unsubscribe(name, params);
      });

      var events = node.getAllPublishEvents();

      events.forEach(function(event) {
        bus.on(event.name, function() {
          if(socket.connected) {
            var results = [];

            for(var i = 0; i < arguments.length; i++) {
              results.push(arguments[i]);
            }

            var params = [event.name].concat(results);
            socket.emit.apply(socket, params);
          }
        });
      });

      socket.on('disconnect', function() {
        bus.close();
      });

    });

  });

  node.on('error', function(err) {
    log.error(err);
  });

  node.chain.on('addblock', function(block) {
    count++;
    // Initialize logging if not already instantiated
    if (!interval) {
      interval = setInterval(function() {
        logSyncStatus();
        count = 0;
      }, 10000);
    }
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
      process.exit(-1);
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
