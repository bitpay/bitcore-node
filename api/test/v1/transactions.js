'use strict';

var chai = require('chai');
var should = chai.should();

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var Transaction = bitcore.Transaction;
var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();

var BitcoreNode = require('../../../');
var mockTransactions = require('../data/transactions');

describe('BitcoreHTTP v1 transactions routes', function() {

  // mocks
  var mockValidTx = new Transaction();
  var t1 = mockTransactions[_.keys(mockTransactions)[0]];
  var nodeMock, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.transactionService = {};
    nodeMock.transactionService.getTransaction = function(txHash) {
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
    agent = require('../app')(nodeMock);
  });

  var failsWithInvalidHash = function(agent, url, cb) {
    agent.get(url)
      .expect(422)
      .expect('/v1/transactions/ parameter must be a 64 digit hex', cb);
  };
  var reportsNotFound = function(agent, url, cb) {
    agent.get(url)
      .expect(404)
      .expect('Transaction with id 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000 not found', cb);
  };

  describe('/transactions/:txHash', function() {
    it('fails with invalid txHash', function(cb) {
      failsWithInvalidHash(agent, '/v1/transactions/abad1dea', cb);
    });
    it('returns 404 with non existent transaction', function(cb) {
      reportsNotFound(agent, '/v1/transactions/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000', cb);
    });
    _.keys(mockTransactions).forEach(function(hash) {
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
  });
  var testIO = function(name) {
    describe('/transactions/:txHash/' + name + '/', function() {
      it('fails with invalid txHash', function(cb) {
        failsWithInvalidHash(agent, '/v1/transactions/abad1dea/' + name, cb);
      });
      it('returns 404 with non existent transaction', function(cb) {
        reportsNotFound(agent,
          '/v1/transactions/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000/' + name, cb);
      });
      _.keys(mockTransactions).forEach(function(hash) {
        var tx = mockTransactions[hash];
        var summary = hash.substring(hash.length - 8);
        it('works with valid txHash ...' + summary + 'getting all ' + name, function(cb) {
          agent.get('/v1/transactions/' + hash + '/' + name + '/')
            .expect(200)
            .expect(tx[name].map(function(x) {
              return x.toJSON();
            }), cb);
        });
        var canGetSpecificInput = function(i) {
          var x = tx[name][i];
          return function(cb) {
            agent.get('/v1/transactions/' + hash + '/' + name + '/' + i)
              .expect(200)
              .expect(x.toJSON(), cb);
          };
        };
        for (var i = 0; i < tx[name].length; i++) {
          it('works with valid txHash ...' + summary + ' ' + name + ' ' + i, canGetSpecificInput(i));
        }
        it('fails with invalid ' + name + ' index ' + i + ' for txHash ...' + summary, function(cb) {
          agent.get('/v1/transactions/' + hash + '/' + name + '/' + i)
            .expect(404, cb);
        });
      });
      it('fails with invalid ' + name + ' format', function(cb) {
        agent.get('/v1/transactions/' + t1.id + '/' + name + '/-1')
          .expect(422)
          .expect('index parameter must be a positive integer', cb);
      });
    });
  };
  testIO('inputs');
  testIO('outputs');
});
