'use strict';

var chai = require('chai');
var should = chai.should();

var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();
var bitcore = require('bitcore');
var _ = bitcore.deps._;


var mockAddresses = require('../data/addresses');

describe('BitcoreHTTP v1 addresses routes', function() {

  // mocks
  var nodeMock, agent;
  var utxos_for_addrs = function(addrs) {
    return _.reduce(addrs, function(utxos, addr) {
      return utxos.concat(mockAddresses[addr].utxos);
    }, []);
  };

  var powerset = function(set) {
    if (set.length === 0) {
      return [
        []
      ];
    }
    var sets = [];
    var head = set.shift();
    var tail = set;
    powerset(tail).forEach(function(s) {
      var copy = s.slice();
      copy.push(head);

      sets.push(copy);
      sets.push(s);
    });
    return sets;
  };

  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.addressService = {};
    nodeMock.addressService.getSummary = function(address) {
      return Promise.resolve(mockAddresses[address.toString()].summary);
    };
    nodeMock.addressService.getUnspent = function(addresses) {
      return Promise.resolve(utxos_for_addrs(addresses));
    };
    agent = require('../app')(nodeMock);
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
    _.keys(mockAddresses).forEach(function(addr) {
      var info = mockAddresses[addr];
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr)
          .expect(200)
          .expect(info.summary, cb);
      });
    });
  });
  describe('/addresses/:address/utxos', function() {
    it('fails with invalid address', function(cb) {
      agent.get('/v1/addresses/1BpbpfLdY7oBS9gK7aDXgvMgr1DpvNH3B2/utxos')
        .expect(422)
        .expect('/v1/addresses/ parameter must be a bitcoin address list', cb);

    });
    _.keys(mockAddresses).forEach(function(addr) {
      it('works with valid address ' + addr, function(cb) {
        agent.get('/v1/addresses/' + addr + '/utxos')
          .expect(200)
          .expect(utxos_for_addrs([addr]), cb);
      });
    });
  });
  describe('/addresses/:addresses/utxos', function() {
    powerset(_.keys(mockAddresses)).forEach(function(addresses) {
      if (addresses.length === 0) {
        return;
      }
      var list = addresses.join(',');
      it('works with valid addresses ' + list, function(cb) {
        var path = '/v1/addresses/' + list + '/utxos';
        agent.get(path)
          .expect(200)
          .expect(utxos_for_addrs(addresses), cb);
      });
    });
  });
});
