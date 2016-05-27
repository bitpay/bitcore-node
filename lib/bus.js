'use strict';

var events = require('events');
var util = require('util');

/**
 * The bus represents a connection to node, decoupled from the transport layer, that can
 * listen and subscribe to any events that are exposed by available services. Services
 * can expose events that can be subscribed to by implementing a `getPublishEvents` method.
 * @param {Object} params
 * @param {Node} params.node - A reference to the node
 */
function Bus(params) {
  events.EventEmitter.call(this);
  this.node = params.node;
  this.remoteAddress = params.remoteAddress;
}

util.inherits(Bus, events.EventEmitter);

/**
 * This function will find the service that exposes the event by name and
 * call the associated subscribe method with the arguments excluding the
 * first argument of this function.
 * @param {String} name - The name of the event
 */
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

/**
 * The inverse of the subscribe method.
 * @param {String} name - The name of the event
 */
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

/**
 * This function will unsubscribe all events.
 */
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
