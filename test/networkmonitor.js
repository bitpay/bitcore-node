'use strict';

var chai = require('chai');
var should = chai.should();
var bitcore = require('bitcore');
var Transaction = bitcore.Transaction;
var EventEmitter = require('events').EventEmitter;

var NetworkMonitor = require('../lib/networkmonitor');
var EventBus = require('../lib/eventbus');

describe('NetworkMonitor', function() {

  // mocks
  var mockTx, busMock, peerMock;
  beforeEach(function() {
    mockTx = new Transaction();
    busMock = new EventBus();
    peerMock = new EventEmitter();
    peerMock.connect = function() {
      this.emit('tx', {
        transaction: mockTx
      });
    };
  });

  it('instantiate', function() {
    var nm = new NetworkMonitor(busMock, peerMock);
    should.exist(nm);
  });

  it('start', function(cb) {
    var nm = new NetworkMonitor(busMock, peerMock);
    busMock.register(bitcore.Transaction, function(tx) {
      tx.id.should.equal(mockTx.id);
      cb();
    });
    nm.start();
  });

});
