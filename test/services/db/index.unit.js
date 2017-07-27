'use strict';

var chai = require('chai');
var should = chai.should();
var assert = chai.assert;
var expect = chai.expect;
var DBService = require('../../../lib/services/db');
var sinon = require('sinon');
var Levelup = require('levelup');

describe('DB', function() {

  var dbService;

  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    dbService = new DBService({
      node: {
        services: [],
        datadir: '/tmp',
        network: 'regtest',
        on: sinon.stub()
      }
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('#start', function() {
    it('should start the db service by creating a db dir, ' +
      ' if necessary, and setting the store', function(done) {
      dbService.start(function() {
        dbService._store.should.be.instanceOf(Levelup);
        done();
      });
    });
  });

  describe('#stop', function() {
    it('should stop if store not open', function(done) {
      dbService.stop(function() {
        var close = sandbox.stub().callsArg(0);
        dbService._store = { close: close };
        dbService._stopping.should.be.true;
        done();
      });
    });

    it('should stop if store open', function(done) {
      dbService.stop(function() {
        var close = sandbox.stub().callsArg(0);
        dbService._store = { close: close, isOpen: sinon.stub().returns(true) };
        dbService._stopping.should.be.true;
        done();
      });
    });
  });

  describe('#_onError', function() {
    it('should stop the db', function() {
      var stop = sandbox.stub();
      dbService.node = { stop: stop };
      dbService._onError(new Error('some error'));
      stop.should.be.calledOnce;
    });
  });

  describe('#_setDataPath', function() {

    it('should set the data path', function() {
      dbService._setDataPath();
      dbService.dataPath.should.equal('/tmp/regtest/bitcore-node.db');
    });

  });

  describe('#_setVersion', function() {
    it('should set the version', function(done) {
      var put = sandbox.stub(dbService, 'put').callsArgWith(2, null);
      dbService._setVersion(function(err) {
        put.should.be.calledOnce;
        put.args[0][0].toString('hex').should.deep.equal('ffff76657273696f6e');
        put.args[0][1].toString('hex').should.deep.equal('00000001');
        done();
      });
    });
  });

  describe('#get', function() {
    it('should get a value from the db', function(done) {
      var get = sandbox.stub().callsArgWith(2, null, 'data');
      dbService._store = { get: get };
      dbService.get('key', function(err, value) {
        if (err) {
          return done(err);
        }
        value.should.equal('data');
        done();
      });
    });

    it('should not get a value while the node is shutting down', function(done) {
      dbService._stopping = true;
      dbService.get('key', function(err, value) {
        err.message.should.equal('Shutdown sequence underway, not able to complete the query');
        done();
      });
    });

  });

  describe('#put', function() {
    it('should put a value in the db', function(done) {
      var put = sandbox.stub().callsArgWith(2, null);
      dbService._store = { put: put };
      dbService.put(new Buffer('key'), new Buffer('value'), function(err) {
        if (err) {
          return done(err);
        }
        put.should.be.calledOnce;
        done();
      });
    });

    it('should not allow an operation while the node is shutting down', function(done) {
      dbService._stopping = true;
      dbService.put(new Buffer('key'), new Buffer('value'), function(err) {
        done();
      });
    });
  });

  describe('#batch', function() {
  });

  describe('#createReadStream', function() {
  });

  describe('#createKeyStream', function() {
  });

  describe('#close', function() {
  });

  describe('#getServiceTip', function() {
  });

  describe('#getPrefix', function() {
  });
});

