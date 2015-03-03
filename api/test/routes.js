'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;

var BitcoreHTTP = require('../lib/http');

describe('BitcoreHTTP routes', function() {

  // mocks
  var nodeMock, app, agent;
  beforeEach(function() {
    var opts = {
      port: 1234
    };
    nodeMock = new EventEmitter();
    app = new BitcoreHTTP(nodeMock, opts).app;
    agent = request(app);
  });
  it('404s', function(cb) {
    agent.get('/invalid/url/')
      .expect(404, cb);
  });
  it('main', function(cb) {
    agent.get('/')
      .expect(200)
      .expect('bitcore-node API', cb);
  });

});
