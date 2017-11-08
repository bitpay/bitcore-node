'use strict';

var sinon = require('sinon');
var HeaderService = require('../../../lib/services/header');
var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;
var Encoding  = require('../../../lib/services/header/encoding');
var utils = require('../../../lib/utils');
var Block = require('bitcore-lib').Block;
var BN = require('bn.js');
var Emitter = require('events').EventEmitter;
var bcoin = require('bcoin');

describe('Header Service', function() {

  var headerService;
  var sandbox;
  var prevHeader = new Block(new Buffer('01000000b25c0849b469983b4a5b90a49e4c0e4ba3853122ed141b5bd92d14000000000021a8aaa4995e4ce3b885677730b153741feda66a08492287a45c6a131671ba5a72ff504c5a0c011c456e4d060201000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c028208ffffffff0100f2052a010000004341041994d910507ec4b2135dd32a4723caf00f8567f356ffbd5e703786d856b49a89d6597c280d8981238fbde81fa3767161bc3e994c17be41b42235a61c24c73459ac0000000001000000013b517d1aebd89b4034e0cf9b25ecbe82ef162ce71284e92a1f1adebf44ea1409000000008b483045022100c7ebc62e89740ddab42a64435c996e1c91a063f9f2cc004b4f023f7a1be5234402207608837faebec16049461d4ef7de807ce217040fd2a823a29da16ec07e463d440141048f108c0da4b5be3308e2e0b521d02d341de85b36a29285b47f00bc33e57a89cf4b6e76aa4a48ddc9a5e882620779e0f1b19dc98d478052fbd544167c745be1d8ffffffff010026e85a050000001976a914f760ef90462b0a4bde26d597c1f29324f5cd0fc488ac00000000', 'hex')).header.toObject();
  var preObjectHeader = new Block(new Buffer('010000006a39821735ec18a366d95b391a7ff10dee181a198f1789b0550e0d00000000002b0c80fa52b669022c344c3e09e6bb9698ab90707bb4bb412af3fbf31cfd2163a601514c5a0c011c572aef0f0101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff08045a0c011c022003ffffffff0100f2052a01000000434104c5b694d72e601091fd733c6b18b94795c13e2db6b1474747e7be914b407854cad37cee3058f85373b9f9dbb0014e541c45851d5f85e83a1fd7c45e54423718f3ac00000000', 'hex')).header;
  var header = preObjectHeader.toObject();
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    headerService = new HeaderService({
      node: {
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
      var setListeners = sandbox.stub(headerService, '_setListeners');
      var getPrefix = sandbox.stub().callsArgWith(1, null, new Buffer('ffee', 'hex'));
      var adjustHeadersForCheckPointTip = sandbox.stub(headerService, '_adjustHeadersForCheckPointTip').callsArgWith(0, null);
      var setGenesisBlock = sandbox.stub(headerService, '_setGenesisBlock').callsArgWith(0, null);
      headerService.GENESIS_HASH = '00';
      var openBus = sandbox.stub();
      headerService.node = { openBus: openBus };
      var _startHeaderSubscription = sandbox.stub(headerService, '_startHeaderSubscription');

      headerService._db = { getPrefix: getPrefix, getServiceTip: getServiceTip, batch: sinon.stub() };

      headerService.start(function() {
        expect(setGenesisBlock.calledOnce).to.be.true;
        expect(adjustHeadersForCheckPointTip.calledOnce).to.be.true;
        expect(setListeners.calledOnce).to.be.true;
        expect(headerService._tip).to.be.deep.equal({ height: 0, hash: '00' });
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
      headerService._tip = { height: 123 };

      var fakeStream = new Emitter();
      var createReadStream = sandbox.stub().returns(fakeStream);
      headerService._db = { createReadStream: createReadStream };

      headerService.getAllHeaders(function(err, headers) {
        if (err) {
          return done(err);
        }

        expect(headers.length).to.deep.equal(1);
        expect(headers.get(header.hash).hash).to.equal('00000000008ba8d6beb01577730fae52517988564322026e5e2d90a3ee5d3cfb');
        done();
      });

      header.chainwork = '00';
      fakeStream.emit('data', { value: headerService._encoding.encodeHeaderValue(header) });
      fakeStream.emit('end');

    });
  });

  describe('#_startSync', function() {

    it('should start the sync process', function() {
      var removeAllSubs = sandbox.stub(headerService, '_removeAllSubscriptions');
      headerService._blockProcessor = { length: sinon.stub().returns(0) };
      headerService._bestHeight = 100;
      headerService._tip = { height: 98 };
      var sync = sandbox.stub(headerService, '_sync');
      headerService._startSync();
      expect(removeAllSubs.calledOnce).to.be.true;
      expect(sync.calledOnce).to.be.true;
    });

  });

  describe('#_sync', function() {

    it('should sync headers', function() {
      var startHeaderSub = sandbox.stub(headerService, '_startHeaderSubscription');
      var getP2PHeaders = sandbox.stub(headerService, '_getP2PHeaders');
      headerService._tip = { hash: 'aa' };
      headerService._sync();
      expect(getP2PHeaders.calledOnce).to.be.true;
      expect(startHeaderSub.calledOnce).to.be.true;
    });

  });

  describe('#_onHeaders', function() {

    it('should handle new headers received', function() {

      var headers = [preObjectHeader];
      var onHeader = sandbox.stub(headerService, '_onHeader');
      var saveHeaders = sandbox.stub(headerService, '_saveHeaders');
      headerService._tip = { height: 123, hash: 'aa' };

      var lastHeader = Object.assign({ height: 1, chainwork: new Array(65).join('0') }, prevHeader);
      headerService._lastHeader = lastHeader;

      headerService._onHeaders(headers);

      expect(onHeader.calledOnce).to.be.true;
      expect(saveHeaders.calledOnce).to.be.true;

    });
  });

  describe('#_getChainwork', function() {

    it('should get chainwork', function() {
      prevHeader.chainwork = '000000000000000000000000000000000000000000000000000d4b2e8ee30c08';
      var actual = headerService._getChainwork(header, prevHeader);
      prevHeader.chainwork = '000000000000000000000000000000000000000000000000000d4b2e8ee30c08';
      expect(actual.toString(16, 64)).to.equal('000000000000000000000000000000000000000000000000000d4c22c66d0d72');
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

  describe('#_adjustHeadersForCheckPointTip', function() {
    it('should get the last header from which to start synchronizing more headers', function(done) {

      var stream = new Emitter();
      var header = Object.assign({ chainwork: '00', height: 2 }, prevHeader );
      var headerBuf = headerService._encoding.encodeHeaderValue(header);

      headerService._tip = { height: 2, hash: 'aa' };

      headerService._db = {
        createReadStream: sandbox.stub().returns(stream),
        batch: sandbox.stub().callsArgWith(1, null)
      };
      headerService._adjustHeadersForCheckPointTip(function(err) {
        if(err) {
          return done(err);
        }
        expect(headerService._tip.hash).to.equal(header.hash);
        done();
      });
      stream.emit('data', { value: headerBuf });
      stream.emit('end');
    });
  });
});
