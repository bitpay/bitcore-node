'use strict';

var events = require('events');
var util = require('util');

function Bus(params) {
  events.EventEmitter.call(this);
  this.db = params.db;
}

util.inherits(Bus, events.EventEmitter);

Bus.prototype.subscribe = function(name) {
  for (var i = 0; i < this.db.modules; i++) {
    var module = this.db.modules[i];
    var events = module.getEvents();
    for (var j = 0; i < events.length; j++) {
      var eventName = events[0];
      var subscribeHandler = events[2];
      var params = arguments.slice(1);
      if (name === eventName) {
        subscribeHandler.apply(events[1], params);
      }
    }
  }
};

Bus.prototype.unsubscribe = function(name) {
  for (var i = 0; i < this.db.modules; i++) {
    var module = this.db.modules[i];
    var events = module.getEvents();
    for (var j = 0; i < events.length; j++) {
      var eventName = events[0];
      var unsubscribeHandler = events[3];
      var params = arguments.slice(1);
      if (name === eventName) {
        unsubscribeHandler.apply(events[1], params);
      }
    }
  }
};

module.exports = Bus;
