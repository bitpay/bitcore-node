'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;

var BitcoreHTTP = require('../../lib/http');
var mockBlocks = require('../data/blocks');

describe('BitcoreHTTP v1 blocks routes', function() {

  // mocks
  var b1 = mockBlocks[Object.keys(mockBlocks)[0]];
  var nodeMock, app, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  describe('/blocks', function() {
    it('works with default parameters', function(cb) {
      agent.get('/v1/blocks/')
        .expect(200)
        .expect({
          'message': 'This is a mocked response'
        }, cb);
    });
  });
  describe('/blocks/:blockHash', function() {
    it('fails with invalid blockHash', function(cb) {
      agent.get('/v1/blocks/abad1dea')
        .expect(422)
        .expect('blockHash parameter must be a 64 digit hex', cb);
    });
    it('returns 404 with non existent block', function(cb) {
      agent.get('/v1/blocks/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000')
        .expect(404)
        .expect('Block 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000 not found', cb);
    });
    it('works with valid blockHash', function(cb) {
      agent.get('/v1/blocks/' + b1.hash)
        .expect(200)
        .expect(b1.toJSON(), cb);
    });
  });

});
