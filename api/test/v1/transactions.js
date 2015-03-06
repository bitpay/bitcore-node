'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;

var BitcoreHTTP = require('../../lib/http');
var mockTransactions = require('../data/transactions');

describe('BitcoreHTTP v1 transactions routes', function() {

  // mocks
  var nodeMock, app, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  describe('/transactions', function() {
    it('works with default parameters', function(cb) {
      agent.get('/v1/transactions/')
        .expect(200)
        .expect({
          'message': 'This is a mocked response'
        }, cb);
    });
  });
  describe('/transactions/:txHash', function() {
    it('fails with invalid txHash', function(cb) {
      agent.get('/v1/transactions/abad1dea')
        .expect(422)
        .expect('/v1/transactions/ parameter must be a 64 digit hex', cb);
    });
    it('returns 404 with non existent transaction', function(cb) {
      agent.get('/v1/transactions/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000')
        .expect(404)
        .expect('Transaction with id 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000 not found', cb);
    });
    Object.keys(mockTransactions).forEach(function(hash) {
      it('works with valid txHash ...' + hash.substring(hash.length - 8), function(cb) {
        agent.get('/v1/transactions/' + hash)
          .expect(200)
          .expect(mockTransactions[hash].toJSON(), cb);
      });
    });
  });

});
