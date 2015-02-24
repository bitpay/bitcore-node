'use strict';


var bitcore = require('bitcore');
var Promise = require('bluebird');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var EventBus = require('./eventbus');


var p2p = require('bitcore-p2p');

function NetworkMonitor(eventBus) {
  $.checkArgument(eventBus instanceof EventBus);
  this.bus = eventBus;
}
util.inherits(NetworkMonitor, EventEmitter);

module.exports = NetworkMonitor;
