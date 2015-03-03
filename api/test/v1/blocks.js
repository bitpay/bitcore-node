'use strict';

var chai = require('chai');
var should = chai.should();
var request = require('supertest');

var EventEmitter = require('eventemitter2').EventEmitter2;

var BitcoreHTTP = require('../../lib/http');

describe('BitcoreHTTP v1 blocks routes', function() {

  // mocks
  var nodeMock, app, agent;
  beforeEach(function() {
    var opts = {
      port: 1234
    };
    nodeMock = new EventEmitter();
    app = new BitcoreHTTP(nodeMock, opts).app;
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
    it('works with valid blockHash', function(cb) {
      agent.get('/v1/blocks/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
        .expect(200)
        .expect('{"header":{"version":1,"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","merkleRoot":"3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a","time":1231006505,"bits":486604799,"nonce":2083236893},"transactions":[{"version":1,"inputs":[{"prevTxId":"0000000000000000000000000000000000000000000000000000000000000000","outputIndex":4294967295,"sequenceNumber":4294967295,"script":"4 0xffff001d 1 0x04 69 0x5468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73"}],"outputs":[{"satoshis":5000000000,"script":"65 0x04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f OP_CHECKSIG"}],"nLockTime":0}]}', cb);
    });
  });

});
