'use strict';


var bitcore = require('bitcore');
var Promise = require('bluebird');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('eventemitter2').EventEmitter2;
var util = require('util');

function EventBus() {
  this.handlers = {};
}
util.inherits(EventBus, EventEmitter);

EventBus.prototype.process = function(e) {
  $.checkArgument(_.isObject(e));

  var self = this;
  var done = [];

  var processEvent = function(event) {
    done = done.concat(event);
    var handlers = self.handlers[event.constructor.name] || [];
    var whenHandlersResolve = Promise.all(handlers.map(function(handler) {
      return handler(event);
    }));
    return whenHandlersResolve.each(function(events) {
      if (_.isUndefined(events)) {
        events = [];
      }
      if (!_.isArray(events)) {
        events = [events];
      }
      return Promise.all(
        events.map(processEvent)
      );
    });
  };
  var eventsEmitted = processEvent(e)
    .then(function() {
      done.forEach(function(event) {
        self.emit(event.name || event.constructor.name, event);
      });
    });
  return eventsEmitted;
};


EventBus.prototype.register = function(clazz, handler) {
  $.checkArgument(_.isFunction(handler));
  var name = clazz.name;
  this.handlers[name] = this.handlers[name] || [];
  this.handlers[name].push(handler);
};


module.exports = EventBus;
