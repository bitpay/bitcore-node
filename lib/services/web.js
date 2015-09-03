'use strict';

var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var socketio = require('socket.io');
var BaseService = require('../service');
var inherits = require('util').inherits;

var WebService = function(options) {
  var self = this;
  this.node = options.node;
  this.port = options.port || this.node.port || 3456;

  this.node.on('ready', function() {
    self.setupAllRoutes();
    self.server.listen(self.port);
    self.createMethodsMap();
  });
};

inherits(WebService, BaseService);

WebService.dependencies = [];

WebService.prototype.start = function(callback) {
  var self = this;
  this.app = express();
  this.app.use(bodyParser.json());

  this.server = http.createServer(this.app);

  this.io = socketio.listen(this.server);
  this.io.on('connection', this.socketHandler.bind(this));

  setImmediate(callback);
};

WebService.prototype.stop = function(callback) {
  var self = this;

  setImmediate(function() {
    if(self.server) {
      self.server.close();
    }

    callback();
  })
};

WebService.prototype.setupAllRoutes = function() {
  for(var key in this.node.services) {
    var subApp = new express.Router();
    this.app.use('/' + this.node.services[key].getRoutePrefix(), subApp);
    this.node.services[key].setupRoutes(subApp, express);
  }
};

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
}

WebService.prototype.socketHandler = function(socket) {
  var self = this;

  var bus = this.node.openBus();

  socket.on('message', this.socketMessageHandler.bind(this));

  socket.on('subscribe', function(name, params) {
    bus.subscribe(name, params);
  });

  socket.on('unsubscribe', function(name, params) {
    bus.unsubscribe(name, params);
  });

  var events = self.node.getAllPublishEvents();
  var eventNames = [];

  events.forEach(function(event) {
    eventNames.push(event.name);

    if(event.extraEvents) {
      eventNames = eventNames.concat(event.extraEvents);
    }
  });

  eventNames = eventNames.filter(function(value, index, self) {
    // remove any duplicates
    return self.indexOf(value) === index;
  });

  eventNames.forEach(function(eventName) {
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
    bus.close();
  });
};

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

module.exports = WebService;