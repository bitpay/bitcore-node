'use strict';

var http = require('http');
var express = require('express');
var socketio = require('socket.io');

var WebService = function(options) {
  this.node = options.node;
  this.port = options.port || 3456;
};

WebService.prototype.start = function(callback) {
  var self = this;
  this.app = express();

  this.server = http.createServer(this.app);
  this.server.listen(this.port);
  this.setupRoutes();

  this.io = socketio.listen(this.server);
  this.io.on('connection', this.socketHandler.bind(this));

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

  setImmediate(callback);
};

WebService.prototype.stop = function(callback) {
  var self = this;

  setImmediate(function() {
    self.server.close();
    callback();
  })
};

WebService.prototype.setupRoutes = function() {
  for(var i = 0; i < this.node.db.modules.length; i++) {
    this.node.db.modules[i].setupRoutes(this.app);
  }
};

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
          message: 'Expected ' + this.methodsMap[message.method].args + ' parameters'
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