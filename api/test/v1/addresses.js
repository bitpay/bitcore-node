'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();
var bitcore = require('bitcore');
var _ = bitcore.deps._;

var BitcoreHTTP = require('../../lib/http');

var mockAddresses = require('../data/addresses');
var mockTransactions = require('../data/transactions');

describe('BitcoreHTTP v1 addresses routes', function() {

  // mocks
  var transactionList = Object.values(mockTransactions);
  var nodeMock, app, agent;
  var txs_for_addr = function(addr) {
    var amount = mockAddresses[addr].summary.transactions.length;
    return transactionList.slice(0, amount);
  };
  var utxos_for_addr = function(addr) {
    return mockAddresses[addr].utxos;
  };

  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.getAddressInfo = function(address) {
      return Promise.resolve(mockAddresses[address.toString()]);
    };
    nodeMock.listTransactions = function(opts) {
      return Promise.resolve(txs_for_addr(opts.address));
    };
    nodeMock.getUTXOs = function(address) {
      return Promise.resolve(utxos_for_addr(address));
    };
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  var failsWithInvalidAddress = function(agent, url, cb) {
    agent.get(url)
      .expect(422)
      .expect('/v1/addresses/ parameter must be a valid bitcoin address', cb);
  };

  describe('/addresses/:address', function() {
    it('fails with invalid address', function(cb) {
      failsWithInvalidAddress(agent, '/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2', cb);
    });
    Object.keys(mockAddresses).forEach(function(addr) {
      var info = mockAddresses[addr];
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr)
          .expect(200)
          .expect(JSON.stringify(info), cb);
      });
    });
  });
  describe('/addresses/:address/transactions', function() {
    it('fails with invalid address', function(cb) {
      failsWithInvalidAddress(agent, '/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2/transactions', cb);
    });
    Object.keys(mockAddresses).forEach(function(addr) {
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr + '/transactions')
          .expect(200)
          .expect(JSON.stringify(txs_for_addr(addr)), cb);
      });
    });
  });
  describe('/addresses/:address/utxos', function() {
    it('fails with invalid address', function(cb) {
      failsWithInvalidAddress(agent, '/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2/utxos', cb);
    });
    Object.keys(mockAddresses).forEach(function(addr) {
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr + '/utxos')
          .expect(200)
          .expect(JSON.stringify(utxos_for_addr(addr)), cb);
      });
    });
  });
});
