'use strict';

var chai = require('chai');
var should = chai.should();

var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('bluebird');
Promise.longStackTraces();

describe('BitcoreHTTP v1 node routes', function() {

  // mocks
  var nodeMock, agent;
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.status = {
      sync: 0.75,
      peerCount: 8,
      version: 'test',
      network: 'regtest',
      height: 60000,
    };
    nodeMock.getStatus = function() {
      return Promise.resolve(nodeMock.status);
    };
    agent = require('../app')(nodeMock);
  });

  describe('/v1/node', function() {
    it('works', function(cb) {
      agent.get('/v1/node/')
        .expect(200, function(err, res) {
          should.not.exist(err);
          should.exist(res.body);
          var r = res.body;
          should.exist(r.sync);
          should.exist(r.peerCount);
          should.exist(r.version);
          should.exist(r.network);
          should.exist(r.height);
          cb();
        });
    });
  });

});
