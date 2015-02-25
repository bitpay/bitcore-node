'use strict';

var chai = require('chai');
var should = chai.should();
var bitcore = require('bitcore');
var sinon = require('sinon');
var util = require('util');
var Transaction = bitcore.Transaction;
var Block = bitcore.Block;
var EventEmitter = require('events').EventEmitter;

var NetworkMonitor = require('../lib/networkmonitor');
var EventBus = require('../lib/eventbus');

describe('NetworkMonitor', function() {

  // mocks
  var mockTx, mockBlock, busMock, peerMock;
  beforeEach(function() {
    mockTx = new Transaction();
    var genesishex = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';
    var genesisbuf = new Buffer(genesishex, 'hex');
    mockBlock = new Block(genesisbuf);
    mockBlock.id = 'asd';
    busMock = new EventBus();
    peerMock = new EventEmitter();
    peerMock.sendMessage = sinon.spy();
    peerMock.connect = function() {
      this.emit('ready');
      this.emit('inv', {
        inventory: []
      });
      this.emit('tx', {
        transaction: mockTx
      });
      this.emit('block', {
        block: mockBlock
      });
    };
  });

  it('instantiates correctly from constructor', function() {
    var nm = new NetworkMonitor(busMock, peerMock);
    should.exist(nm);
  });

  it('instantiates correctly from create', function() {
    var nm = NetworkMonitor.create(busMock);
    should.exist(nm);
  });

  it('start', function() {
    var nm = new NetworkMonitor(busMock, peerMock);
    nm.start.bind(nm).should.not.throw();
  });

  it('broadcasts ready after start', function(cb) {
    var nm = new NetworkMonitor(busMock, peerMock);
    nm.on('ready', cb)
    nm.start();
  });

  it('sends getdatas when receiving invs', function() {
    var nm = new NetworkMonitor(busMock, peerMock);
    nm.start();
    peerMock.sendMessage.calledOnce.should.equal(true);
  });

  it('sends transactions to bus', function(cb) {
    var nm = new NetworkMonitor(busMock, peerMock);
    busMock.register(bitcore.Transaction, function(tx) {
      tx.id.should.equal(mockTx.id);
      cb();
    });
    nm.start();
  });

  it('sends blocks to bus', function(cb) {
    var nm = new NetworkMonitor(busMock, peerMock);
    busMock.register(bitcore.Block, function(block) {
      block.id.should.equal(mockBlock.id);
      cb();
    });
    nm.start();
  });

});
