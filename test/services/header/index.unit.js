'use strict';

var sinon = require('sinon');
var HeaderService = require('../../../lib/services/header');
var Tx = require('bcoin').tx;
var expect = require('chai').expect;
var Encoding  = require('../../../lib/services/header/encoding');
var utils = require('../../../lib/utils');
var EventEmitter = require('events').EventEmitter;

describe('Header Service', function() {

  var headerService;
  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    headerService = new HeaderService({
      node: {
        getNetworkName: function() { return 'regtest'; },
        services: []
      }
    });
    headerService._encoding = new Encoding(new Buffer('0000', 'hex'));
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#start', function() {


    it('should get prefix for database', function(done) {

      var getServiceTip = sandbox.stub().callsArgWith(1, null, { height: 123, hash: 'a' });
      var startSubs = sandbox.stub(headerService, '_startSubscriptions');
      var setListeners = sandbox.stub(headerService, '_setListeners');
      var getPrefix = sandbox.stub().callsArgWith(1, null, new Buffer('ffee', 'hex'));

      headerService._db = { getPrefix: getPrefix, getServiceTip: getServiceTip };

      headerService.start(function() {
        expect(startSubs.calledOnce).to.be.true;
        expect(setListeners.calledOnce).to.be.true;
        expect(headerService._tip).to.be.deep.equal({ height: 123, hash: 'a' });
        expect(headerService._encoding).to.be.instanceOf(Encoding);
        done();
      });

    });

  });

  describe('#stop', function() {
    it('should stop the service', function(done) {
      headerService.stop(function() {
        done();
      });
    });
  });

  describe('#getAllHeaders', function() {
    it('should get all the headers', function(done) {

      var stream = new EventEmitter();
      var createReadStream = sandbox.stub().returns(stream);
      var hash = sandbox.stub().returns('a');
      var header = sandbox.stub().returns({});
      var hashKey = sandbox.stub();
      var headerVal = sandbox.stub();

      headerService._db = { createReadStream: createReadStream };
      headerService._encoding = { decodeHeaderKey: hash, decodeHeaderValue: header, encodeHeaderKey: hashKey, encodeHeaderValue: headerVal };

      headerService.getAllHeaders(function(err, headers) {

        if (err) {
          return callback(err);
        }

        expect(headers).to.be.deep.equal([ { a: {} } ]);
        done();

      });

      stream.emit('data', { key: 'a', value: 'a' });
      stream.emit('end');
    });
  });

  describe('#_startSync', function() {

    it('should start the sync process', function() {
      headerService._bestHeight = 123;
      headerService._tip = { height: 121, hash: 'a' };
      var sync = sandbox.stub(headerService, '_sync');
      headerService._startSync();
      expect(sync.calledOnce).to.be.true;
      expect(headerService._numNeeded).to.equal(2);
    });

  });

  describe('#_sync', function() {
    it('should sync header', function() {
      headerService._p2pHeaderCallsNeeded = 10;
      headerService._numNeeded = 1000;
      headerService._tip = { height: 121, hash: 'a' };
      var getHeaders = sandbox.stub();
      headerService._p2p = { getHeaders: getHeaders };
      headerService._sync();
      expect(getHeaders.calledOnce).to.be.true;
      expect(headerService._p2pHeaderCallsNeeded).to.equal(9);
    });
  });

  describe('#_onHeaders', function() {

    it('should handle new headers received', function() {
      var headers = [ { hash: 'b' } ];
      headerService._tip = { height: 123, hash: 'a' };
      headerService._bestHeight = 123;
      var getHeaderOps = sandbox.stub(headerService, '_getHeaderOperations').returns([]);
      var encodeTip = sandbox.stub().returns({ key: 'b', value: 'b' });
      var batch = sandbox.stub();
      var sync = sandbox.stub(headerService, '_sync');
      utils.encodeTip = encodeTip;
      headerService._db = { batch: batch };
      headerService._onHeaders(headers);
      expect(getHeaderOps.calledOnce).to.be.true;
      expect(encodeTip.calledOnce).to.be.true;
      expect(batch.calledOnce).to.be.true;
      expect(sync.calledOnce).to.be.false;
    });
  });

  describe('#_getChainwork', function() {

    it('should get chainwork', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      headerService._meta = [ { chainwork: '000000000000000000000000000000000000000000677bd68118a98f8779ea90', hash: 'aa' } ];
      headerService._blockQueue = LRU(1);
      headerService._blockQueue.set('bb', { header: { bits: 0x18018d30 }});
      var actual = headerService._getChainwork('bb');
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);
    });

  });

  describe('#_computeChainwork', function() {

    it('should calculate chain work correctly', function() {
      var expected = new BN(new Buffer('000000000000000000000000000000000000000000677c7b8122f9902c79f4e0', 'hex'));
      var prev = new BN(new Buffer('000000000000000000000000000000000000000000677bd68118a98f8779ea90', 'hex'));

      var actual = headerService._computeChainwork(0x18018d30, prev);
      assert(actual.eq(expected), 'not equal: actual: ' + actual + ' expected: ' + expected);
    });

  });

});
