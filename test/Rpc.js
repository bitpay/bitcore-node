'use strict';

var chai = require('chai');
var should = chai.should();

var Promise = require('bluebird');
var EventEmitter = require('eventemitter2').EventEmitter2;
var BitcoindRpc = require('../lib/rpc');
var RpcClient = require('bitcoind-rpc');
var EventBus = require('../lib/eventbus');
Promise.longStackTraces();

describe('BitcoindRpc', function() {

  // mocks
  var busMock;
  var clientMock;
  beforeEach(function() {
    busMock = new EventBus();
    clientMock = new RpcClient();
  });
  describe('instantiates', function() {
    it('from constructor', function() {

      var rpc = new BitcoindRpc(busMock, clientMock);
      should.exist(rpc);
    });
    it('from create', function() {
      var rpc = BitcoindRpc.create(busMock);
      should.exist(rpc);
    });
    it('from create with opts', function() {
      var opts = {
        protocol: 'https',
        host: 'localhost',
        port: 8332,
        user: 'user',
        password: 'pass'
      };
      var rpc = BitcoindRpc.create(busMock, opts);
      should.exist(rpc);
    });
    it('getTxes', function() {
      var rpc = new BitcoindRpc(busMock, clientMock);
      rpc.getTx.bind(rpc).should.not.throw('abc123');
    });
  })
});
