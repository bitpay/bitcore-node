'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var Transaction = bitcore.Transaction;
var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();

var BitcoreHTTP = require('../../lib/http');
var BitcoreNode = require('../../../');
var mockTransactions = require('../data/transactions');

describe('BitcoreHTTP v1 transactions routes', function() {

  // mocks
  var mockValidTx = new Transaction();
  var t1 = mockTransactions[Object.keys(mockTransactions)[0]];
  var nodeMock, app, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.getTransaction = function(txHash) {
      var tx = mockTransactions[txHash];
      if (_.isUndefined(tx)) {
        return Promise.reject(new BitcoreNode.errors.Transactions.NotFound(txHash));
      }
      return Promise.resolve(tx);
    };
    nodeMock.broadcast = function(tx) {
      if (mockTransactions[tx.id]) {
        return Promise.reject(new BitcoreNode.errors.Transactions.CantBroadcast(tx.id));
      }
      return Promise.resolve();
    };
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
  describe('/transactions/send', function() {
    it('fails with invalid data type', function(cb) {
      agent.post('/v1/transactions/send')
        .send('some random data')
        .expect(422)
        .expect('/v1/transactions/send parameter must be a raw transaction hex', cb);
    });
    it('fails with invalid data format', function(cb) {
      agent.post('/v1/transactions/send')
        .send({
          1: 2
        })
        .expect(422)
        .expect('/v1/transactions/send parameter must be a raw transaction hex', cb);
    });
    it('fails with valid data format, invalid raw tx', function(cb) {
      agent.post('/v1/transactions/send')
        .send({
          raw: '00abad1d3a'
        })
        .expect(422)
        .expect('/v1/transactions/send parameter must be a raw transaction hex', cb);
    });
    it('works with valid tx', function(cb) {
      agent.post('/v1/transactions/send')
        .send({
          raw: mockValidTx.uncheckedSerialize()
        })
        .expect(200)
        .expect('Transaction broadcasted successfully', cb);
    });
    it('fails with invalid tx', function(cb) {
      agent.post('/v1/transactions/send')
        .send({
          raw: t1.uncheckedSerialize()
        })
        .expect(422)
        .expect('Unable to broadcast transaction 8c14f0db3df150123e6f3dbbf30f8b955a8249b62ac1d1ff16284aefa3d06d87', cb);
    });
  });

});
