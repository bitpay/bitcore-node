'use strict';


var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var util = require('util');

function Funnel() {
  this.handlers = {};
}
util.inherits(Funnel, EventEmitter);

Funnel.prototype.process = function(e) {
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
    //that.emit(event.name, event);
  });

};


Funnel.prototype.register = function(clazz, handler) {
  $.checkArgument(_.isFunction(handler));
  var name = clazz.name;
  this.handlers[name] = this.handlers[name] || [];
  this.handlers[name].push(handler);
};


module.exports = Funnel;
