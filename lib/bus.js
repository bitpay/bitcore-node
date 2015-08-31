'use strict';

var events = require('events');
var util = require('util');

function Bus(params) {
  events.EventEmitter.call(this);
  this.node = params.node;
}

util.inherits(Bus, events.EventEmitter);

Bus.prototype.subscribe = function(name) {
  var events = [];

  for(var i in this.node.services) {
    var service = this.node.services[i];
    events = events.concat(service.getPublishEvents());
  }

  for (var j = 0; j < events.length; j++) {
    var event = events[j];
    var params = Array.prototype.slice.call(arguments).slice(1);
    params.unshift(this);
    if (name === event.name) {
      event.subscribe.apply(event.scope, params);
    }
  }
};

Bus.prototype.unsubscribe = function(name) {
  var events = [];

  for(var i in this.node.services) {
    var service = this.node.services[i];
    events = events.concat(service.getPublishEvents());
  }

  for (var j = 0; j < events.length; j++) {
    var event = events[j];
    var params = Array.prototype.slice.call(arguments).slice(1);
    params.unshift(this);
    if (name === event.name) {
      event.unsubscribe.apply(event.scope, params);
    }
  }
};

Bus.prototype.close = function() {
  var events = [];

  for(var i in this.node.services) {
    var service = this.node.services[i];
    events = events.concat(service.getPublishEvents());
  }

  // Unsubscribe from all events
  for (var j = 0; j < events.length; j++) {
    var event = events[j];
    event.unsubscribe.call(event.scope, this);
  }
};

module.exports = Bus;
