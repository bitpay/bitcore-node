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

describe('BitcoreHTTP v1 addresses routes', function() {

  // mocks
  var nodeMock, app, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.getAddressInfo = function(address) {
      return Promise.resolve(mockAddresses[address.toString()]);
    };
    nodeMock.listTransactions = function(opts) {
      
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
});
