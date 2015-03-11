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
var mockBlocks = require('../data/blocks');

Object.values = function(obj) {
  var vals = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      vals.push(obj[key]);
    }
  }
  return vals;
};

describe('BitcoreHTTP v1 blocks routes', function() {

  // mocks
  var b1 = mockBlocks[Object.keys(mockBlocks)[0]];
  var firstBlock = mockBlocks[Object.keys(mockBlocks).splice(0, 1)[0]];
  var secondBlock = mockBlocks[Object.keys(mockBlocks).splice(1, 1)[0]];
  var lastBlock = mockBlocks[Object.keys(mockBlocks).splice(-1)[0]];
  var blockForHash = function(hash) {
    return mockBlocks[hash];
  };
  var last3 = Object.keys(mockBlocks).splice(-3).map(blockForHash);
  var some2 = Object.keys(mockBlocks).splice(2,2).map(blockForHash);
  var nodeMock, app, agent;
  var blockList = Object.values(mockBlocks);
  beforeEach(function() {
    nodeMock = new EventEmitter();
    nodeMock.getBlock = function(blockHash) {
      var block;
      if (typeof blockHash === 'number') {
        var height = blockHash;
        block = mockBlocks[Object.keys(mockBlocks)[height - 100000]];
      } else {
        block = mockBlocks[blockHash];
      }
      if (_.isUndefined(block)) {
        return Promise.reject(new BitcoreNode.errors.Blocks.NotFound(blockHash));
      }
      return Promise.resolve(block);

    };
    nodeMock.getLatestBlock = function() {
      return Promise.resolve(lastBlock);
    };
    nodeMock.listBlocks = function(from, to, offset, limit) {
      var start = from - 1e5;
      var end = to - 1e5;
      var section = blockList.slice(start, end);
      return Promise.resolve(section.slice(offset, offset + limit));
    };
    app = new BitcoreHTTP(nodeMock).app;
    agent = request(app);
  });

  describe('/blocks', function() {
    it('works with default parameters', function(cb) {
      agent.get('/v1/blocks/')
        .expect(200)
        .expect(JSON.stringify(blockList), cb);
    });
    it('fails with to<from', function(cb) {
      agent.get('/v1/blocks/?from=100000&to=99999')
        .expect(422)
        .expect('/v1/blocks/ "to" must be >= "from"', cb);
    });
    it('works with to/from parameters', function(cb) {
      agent.get('/v1/blocks/?from=100000&to=100001')
        .expect(200)
        .expect(JSON.stringify([firstBlock]), cb);
    });
    it('works with limit/offset parameters', function(cb) {
      agent.get('/v1/blocks/?limit=1&offset=1')
        .expect(200)
        .expect(JSON.stringify([secondBlock]), cb);
    });
    it('works with all parameters', function(cb) {
      agent.get('/v1/blocks/?from=100005&to=100020&limit=3&offset=2')
        .expect(200)
        .expect(JSON.stringify(last3), cb);
    });
    it('works with all parameters 2', function(cb) {
      agent.get('/v1/blocks/?from=100000&to=100005&limit=2&offset=2')
        .expect(200)
        .expect(JSON.stringify(some2), cb);
    });
  });
  describe('/blocks/latest', function() {
    it('returns latest block', function(cb) {
      agent.get('/v1/blocks/latest')
        .expect(200)
        .expect(lastBlock.toJSON(), cb);
    });
  });
  describe('/blocks/:blockHash', function() {
    it('fails with invalid blockHash', function(cb) {
      agent.get('/v1/blocks/abad1dea')
        .expect(422)
        .expect('/v1/blocks/ parameter must be a 64 digit hex or block height integer', cb);
    });
    it('returns 404 with non existent block', function(cb) {
      agent.get('/v1/blocks/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000')
        .expect(404)
        .expect('Block with id 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b600000000 not found', cb);
    });
    Object.keys(mockBlocks).forEach(function(hash) {
      var block = mockBlocks[hash];
      it('works with valid blockHash ...' + hash.substring(hash.length - 8), function(cb) {
        agent.get('/v1/blocks/' + hash)
          .expect(200)
          .expect(block.toJSON(), cb);
      });
    });
  });
  describe('/blocks/:height', function() {
    it('fails with invalid height', function(cb) {
      agent.get('/v1/blocks/-15')
        .expect(422)
        .expect('/v1/blocks/ parameter must be a 64 digit hex or block height integer', cb);
    });
    it('returns 404 with non existent block', function(cb) {
      agent.get('/v1/blocks/876543')
        .expect(404)
        .expect('Block with height 876543 not found', cb);
    });
    it('works with valid height', function(cb) {
      agent.get('/v1/blocks/100000')
        .expect(200)
        .expect(b1.toJSON(), cb);
    });
  });

});
