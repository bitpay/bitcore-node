'use strict';

var fs = require('fs');
var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var socketio = require('socket.io');
var inherits = require('util').inherits;

var BaseService = require('../service');
var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var index = require('../');
var log = index.log;


/**
 * This service represents a hub for combining several services over a single HTTP port. Services
 * can extend routes by implementing the methods `getRoutePrefix` and `setupRoutes`. Additionally
 * events that are exposed via the `getPublishEvents` and API methods exposed via `getAPIMethods`
 * will be available over a socket.io connection.
 *
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 * @param {Boolean} options.https - Enable https, will default to node.https settings.
 * @param {Object} options.httpsOptions - Options passed into https.createServer, defaults to node settings.
 * @param {String} options.httpsOptions.key - Path to key file
 * @param {String} options.httpsOptions.cert - Path to cert file
 * @param {Boolean} options.enableSocketRPC - Option to enable/disable websocket RPC handling
 * @param {Number} options.port - The port for the service, defaults to node settings.
 */
var WebService = function(options) {
  var self = this;
  this.node = options.node;
  this.https = options.https || this.node.https;
  this.httpsOptions = options.httpsOptions || this.node.httpsOptions;
  this.port = options.port || this.node.port || 3456;

  // set the maximum size of json payload, defaults to express default
  // see: https://github.com/expressjs/body-parser#limit
  this.jsonRequestLimit = options.jsonRequestLimit || '100kb';

  this.enableSocketRPC = _.isUndefined(options.enableSocketRPC) ?
    WebService.DEFAULT_SOCKET_RPC : options.enableSocketRPC;

  this.node.on('ready', function() {
    self.eventNames = self.getEventNames();
    self.setupAllRoutes();
    self.server.listen(self.port);
    self.createMethodsMap();
  });
};

inherits(WebService, BaseService);

WebService.dependencies = [];
WebService.DEFAULT_SOCKET_RPC = true;

/**
 * Called by Node to start the service
 * @param {Function} callback
 */
WebService.prototype.start = function(callback) {
  this.app = express();
  this.app.use(bodyParser.json({limit: this.jsonRequestLimit}));

  if(this.https) {
    this.transformHttpsOptions();
    this.server = https.createServer(this.httpsOptions, this.app);
  } else {
    this.server = http.createServer(this.app);
  }

  this.io = socketio.listen(this.server);
  this.io.on('connection', this.socketHandler.bind(this));

  setImmediate(callback);
};

/**
 * Called by Node. stop the service
 * @param {Function} callback
 */
WebService.prototype.stop = function(callback) {
  var self = this;

  setImmediate(function() {
    if(self.server) {
      self.server.close();
    }
    callback();
  });
};

/**
 * This function will iterate over all of the available services gathering
 * all of the exposed HTTP routes.
 */
WebService.prototype.setupAllRoutes = function() {
  for(var key in this.node.services) {
    var subApp = new express();
    var service = this.node.services[key];

    if(service.getRoutePrefix && service.setupRoutes) {
      this.app.use('/' + this.node.services[key].getRoutePrefix(), subApp);
      this.node.services[key].setupRoutes(subApp, express);
    } else {
      log.debug('No routes defined for: ' + key);
    }
  }
};

/**
 * This function will construct an API methods map of all of the
 * available methods that can be called from enable services.
 */
WebService.prototype.createMethodsMap = function() {
  var self = this;
  var methods = this.node.getAllAPIMethods();
  this.methodsMap = {};

  methods.forEach(function(data) {
    var name = data[0];
    var instance = data[1];
    var method = data[2];
    var args = data[3];
    self.methodsMap[name] = {
      fn: function() {
        return method.apply(instance, arguments);
      },
      args: args
    };
  });
};

/**
 * This function will gather all of the available events exposed from
 * the enabled services.
 */
WebService.prototype.getEventNames = function() {
  var events = this.node.getAllPublishEvents();
  var eventNames = [];

  function addEventName(name) {
    if(eventNames.indexOf(name) > -1) {
      throw new Error('Duplicate event ' + name);
    }
    eventNames.push(name);
  }

  events.forEach(function(event) {
    addEventName(event.name);

    if(event.extraEvents) {
      event.extraEvents.forEach(function(name) {
        addEventName(name);
      });
    }
  });

  return eventNames;
};

WebService.prototype._getRemoteAddress = function(socket) {
  return socket.client.request.headers['cf-connecting-ip'] || socket.conn.remoteAddress;
};

/**
 * This function is responsible for managing a socket.io connection, including
 * instantiating a new Bus, subscribing/unsubscribing and handling RPC commands.
 * @param {Socket} socket - A socket.io socket instance
 */
WebService.prototype.socketHandler = function(socket) {
  var self = this;
  var remoteAddress = self._getRemoteAddress(socket);
  var bus = this.node.openBus({remoteAddress: remoteAddress});

  if (this.enableSocketRPC) {
    socket.on('message', this.socketMessageHandler.bind(this));
  }

  socket.on('subscribe', function(name, params) {
    log.info(remoteAddress, 'web socket subscribe:', name);
    bus.subscribe(name, params);
  });

  socket.on('unsubscribe', function(name, params) {
    log.info(remoteAddress, 'web socket unsubscribe:', name);
    bus.unsubscribe(name, params);
  });

  this.eventNames.forEach(function(eventName) {
    bus.on(eventName, function() {
      if(socket.connected) {
        var results = [];

        for(var i = 0; i < arguments.length; i++) {
          results.push(arguments[i]);
        }

        var params = [eventName].concat(results);
        socket.emit.apply(socket, params);
      }
    });
  });

  socket.on('disconnect', function() {
    log.info(remoteAddress, 'web socket disconnect');
    bus.close();
  });
};

/**
 * This method will handle incoming RPC messages to a socket.io connection,
 * call the appropriate method, and respond with the result.
 * @param {Object} message - The socket.io "message" object
 * @param {Function} socketCallback
 */
WebService.prototype.socketMessageHandler = function(message, socketCallback) {
  if (this.methodsMap[message.method]) {
    var params = message.params;

    if(!params || !params.length) {
      params = [];
    }

    if(params.length !== this.methodsMap[message.method].args) {
      return socketCallback({
        error: {
          message: 'Expected ' + this.methodsMap[message.method].args + ' parameter(s)'
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
    this.methodsMap[message.method].fn.apply(this, params);
  } else {
    socketCallback({
      error: {
        message: 'Method Not Found'
      }
    });
  }
};

/**
 * This method will read `key` and `cert` from disk based on `httpsOptions` and
 * replace the options with the files.
 */
WebService.prototype.transformHttpsOptions = function() {
  if(!this.httpsOptions || !this.httpsOptions.key || !this.httpsOptions.cert) {
    throw new Error('Missing https options');
  }

  this.httpsOptions = {
    key: fs.readFileSync(this.httpsOptions.key),
    cert: fs.readFileSync(this.httpsOptions.cert)
  };
};

module.exports = WebService;
