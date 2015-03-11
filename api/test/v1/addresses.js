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
var BitcoreNode = require('../../../');

var mockAddresses = require('../data/addresses');
var mockTransactions = require('../data/transactions');

describe('BitcoreHTTP v1 addresses routes', function() {

  // mocks
  var transactionList = Object.values(mockTransactions);
  var nodeMock, app, agent, txs_for_addr;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.getAddressInfo = function(address) {
      return Promise.resolve(mockAddresses[address.toString()]);
    };
    txs_for_addr = function(addr) {
      var amount = mockAddresses[addr].transactions.length;
      return transactionList.slice(0, amount);
    };
    nodeMock.listTransactions = function(opts) {
      return Promise.resolve(txs_for_addr(opts.address));
    };
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  describe('/addresses/:addresss', function() {
    it('fails with invalid address', function(cb) {
      agent.get('/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2')
        .expect(422)
        .expect('/v1/addresses/ parameter must be a valid bitcoin address', cb);
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
  describe('/addresses/:addresss/transactions', function() {
    it('fails with invalid address', function(cb) {
      agent.get('/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2/transactions')
        .expect(422)
        .expect('/v1/addresses/ parameter must be a valid bitcoin address', cb);
    });
    Object.keys(mockAddresses).forEach(function(addr) {
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr + '/transactions')
          .expect(200)
          .expect(JSON.stringify(txs_for_addr(addr)), cb);
      });
    });
  });
});
