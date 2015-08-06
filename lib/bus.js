'use strict';

var events = require('events');
var util = require('util');

function Bus(params) {
  events.EventEmitter.call(this);
  this.db = params.db;
}

util.inherits(Bus, events.EventEmitter);

Bus.prototype.subscribe = function(name) {
  var events = this.db.getPublishEvents();

  for(var i = 0; i < this.db.modules.length; i++) {
    var mod = this.db.modules[i];
    events = events.concat(mod.getPublishEvents());
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
  var events = this.db.getPublishEvents();

  for(var i = 0; i < this.db.modules.length; i++) {
    var mod = this.db.modules[i];
    events = events.concat(mod.getPublishEvents());
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
  var events = this.db.getPublishEvents();

  for(var i = 0; i < this.db.modules.length; i++) {
    var mod = this.db.modules[i];
    events = events.concat(mod.getPublishEvents());
  }

  // Unsubscribe from all events
  for (var j = 0; j < events.length; j++) {
    var event = events[j];
    event.unsubscribe.call(event.scope, this);
  }
};

module.exports = Bus;
