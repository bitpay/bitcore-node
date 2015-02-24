'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var bitcore = require('bitcore');

var NetworkMonitor = require('../lib/networkmonitor');
var EventBus = require('../lib/eventbus');
var util = require('util');
var Promise = require('bluebird');
Promise.longStackTraces();

var bus = new EventBus(); //sinon.createStubInstance(EventBus);

describe.only('NetworkMonitor', function() {

  this.timeout(10000);

  it('instantiate', function() {
    var nm = new NetworkMonitor(bus);
    should.exist(nm);
  });
  it('start', function(cb) {
    var nm = new NetworkMonitor(bus);
    bus.register(bitcore.Transaction, function(tx) {
      console.log('new tx: ', tx.id); 
    });
    nm.start();
  });

});
