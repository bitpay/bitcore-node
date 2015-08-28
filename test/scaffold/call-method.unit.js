'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var EventEmitter = require('events').EventEmitter;

describe('#callMethod', function() {

  var expectedUrl = 'http://localhost:3001';
  var expectedOptions = {
    reconnection: false,
    connect_timeout: 5000
  };

  var callOptions = {
    host: 'localhost',
    port: 3001,
    protocol: 'http'
  };

  var callMethod;

  before(function() {
    callMethod = proxyquire('../../lib/scaffold/call-method', {
      'socket.io-client': function(url, options) {
        url.should.equal(expectedUrl);
        options.should.deep.equal(expectedOptions);
        return new EventEmitter();
      }
    });
  });

  it('handle a connection error', function(done) {
    var socket = callMethod(callOptions, 'getInfo', null, function(err) {
      should.exist(err);
      err.message.should.equal('connect');
      done();
    });
    socket.emit('connect_error', new Error('connect'));
  });

  it('give an error response', function(done) {
    var socket = callMethod(callOptions, 'getInfo', null, function(err) {
      should.exist(err);
      err.message.should.equal('response');
      done();
    });
    socket.send = function(opts, callback) {
      opts.method.should.equal('getInfo');
      should.equal(opts.params, null);
      var response = {
        error: {
          message: 'response'
        }
      };
      callback(response);
    };
    socket.emit('connect');
  });

  it('give result and close socket', function(done) {
    var expectedData = {
      version: 110000,
      protocolversion: 70002,
      blocks: 258614,
      timeoffset: -2,
      connections: 8,
      difficulty: 112628548.66634709,
      testnet: false,
      relayfee: 1000,
      errors: ''
    };
    var socket = callMethod(callOptions, 'getInfo', null, function(err, data) {
      should.not.exist(err);
      data.should.deep.equal(expectedData);
      socket.close.callCount.should.equal(1);
      done();
    });
    socket.close = sinon.stub();
    socket.send = function(opts, callback) {
      opts.method.should.equal('getInfo');
      should.equal(opts.params, null);
      var response = {
        error: null,
        result: expectedData
      };
      callback(response);
    };
    socket.emit('connect');
  });

});
