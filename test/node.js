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
  var node, busMock, nmMock, bsMock, tsMock, asMock;
  beforeEach(function() {
    busMock = new EventBus();
    nmMock = new EventEmitter();
    nmMock.start = function() {};
    bsMock = {};
    tsMock = {};
    asMock = {};
    node = new BitcoreNode(busMock, nmMock, bsMock, tsMock, asMock);
  });
  describe('instantiates', function() {
    it('from constructor', function() {
      var n = new BitcoreNode(busMock, nmMock, bsMock, tsMock, asMock);
      should.exist(n);
    });

    it('from create', function() {
      var node = BitcoreNode.create();
      should.exist(node);
    });
  });

  it('starts', function() {
    node.start();
    node.start.bind(node).should.not.throw();
  });

  it('broadcasts errors from network monitor', function(cb) {
    node.on('error', cb);
    nmMock.emit('error');
  });
  it('exposes all events from the event bus', function(cb) {
    node.on('foo', cb);
    busMock.emit('foo');
  });
});
