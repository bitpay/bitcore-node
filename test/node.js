'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');

var Promise = require('bluebird');
var EventEmitter = require('eventemitter2').EventEmitter2;
var BitcoreNode = require('../lib/node');
var EventBus = require('../lib/eventbus');
Promise.longStackTraces();

describe('BitcoreNode', function() {

  // mocks
  var busMock, nmMock, rpcMock;
  beforeEach(function() {
    busMock = new EventBus();
    nmMock = new EventEmitter();
    nmMock.start = function() {};
    rpcMock = {};
  });
  describe('instantiates', function() {
    it('from constructor', function() {
      var node = new BitcoreNode(busMock, nmMock, rpcMock);
      should.exist(node);
    });

    it('from create', function() {
      var node = BitcoreNode.create();
      should.exist(node);
    });
  });

  it('starts', function() {
    var node = new BitcoreNode(busMock, nmMock, rpcMock);
    node.start.bind(node).should.not.throw();
  });

  it('broadcasts errors from network monitor', function(cb) {
    var node = new BitcoreNode(busMock, nmMock, rpcMock);
    node.on('error', cb);
    nmMock.emit('error');
  });
  it('exposes all events from the event bus', function(cb) {
    var node = new BitcoreNode(busMock, nmMock, rpcMock);
    node.on('foo', cb);
    busMock.emit('foo');
  });
});
