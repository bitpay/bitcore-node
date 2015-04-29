'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();

var BitcoreHTTP = require('../../lib/http');

describe('BitcoreHTTP v1 node routes', function() {

  // mocks
  var nodeMock, app, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.status = {
      sync: 0.75,
      peerCount: 8,
      version: 'test',
      network: 'test',
    };
    nodeMock.getStatus = function() {
      return Promise.resolve(nodeMock.status);
    };
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  describe('/node', function() {
    it('works', function(cb) {
      agent.get('/v1/node/')
        .expect(200)
        .expect(nodeMock.status, cb);
    });
  });

});
