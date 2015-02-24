'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');

var NetworkMonitor = require('../lib/networkmonitor');
var EventBus = require('../lib/eventbus');
var util = require('util');
var Promise = require('bluebird');
Promise.longStackTraces();

var bus = sinon.createStubInstance(EventBus);

describe('NetworkMonitor', function() {

  it.only('instantiate', function() {
    var nm = new NetworkMonitor(bus);
    should.exist(nm);
  });

});
