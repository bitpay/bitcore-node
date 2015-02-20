'use strict';


var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function EventBus() {
  this.handlers = {};
}
util.inherits(EventBus, EventEmitter);

EventBus.prototype.process = function(e) {
  $.checkArgument(_.isObject(e));

  var self = this;
  var queue = [];
  var done = [];
  queue.push(e);
  while (queue.length !== 0) {
    var event = queue.shift();
    var handlers = this.handlers[event.constructor.name] || [];
    handlers.forEach(function(handler) {
      var responses = handler(event);
      if (responses && responses.length > 0) {
        queue = queue.concat(responses);
      }
    });
    done.push(event);
  }
  done.forEach(function(event) {
    self.emit(event.name || event.constructor.name, event);
  });

};


EventBus.prototype.register = function(clazz, handler) {
  $.checkArgument(_.isFunction(handler));
  var name = clazz.name;
  this.handlers[name] = this.handlers[name] || [];
  this.handlers[name].push(handler);
};


module.exports = EventBus;
