'use strict';

var should = require('chai').should();
var utils = require('../lib/utils');
var sinon = require('sinon');

describe('Utils', function() {

  describe('#isHeight', function() {

    it('should detect a height', function() {
      utils.isHeight(12).should.be.true;
    });

    it('should detect a non-height', function() {
      utils.isHeight('aaaaaa').should.be.false;
    });

  });

  describe('#isAbsolutePath', function() {

    it('should detect absolute path', function() {
      utils.isAbsolutePath('/').should.be.true;
    });

    it('should not detect absolute path', function() {
      utils.isAbsolutePath('.').should.be.false;
    });

  });

  describe('#parseParamsWithJSON', function() {
    it('should parse json params', function() {
      utils.parseParamsWithJSON([ '{"test":"1"}', '{}', '[]' ])
        .should.deep.equal([{test:'1'}, {}, []]);
    });
  });

  describe('#getTerminalKey', function() {
    it('should get the terminal key for a buffer', function() {
      utils.getTerminalKey(new Buffer('ffff', 'hex'))
        .should.deep.equal(new Buffer('010000', 'hex'));
    });

    it('should get the terminal key for a large buffer', function() {
      utils.getTerminalKey(Buffer.concat([ new Buffer(new Array(64).join('f'), 'hex'), new Buffer('fe', 'hex') ]))
        .should.deep.equal(new Buffer('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex'));
    });
  });

  describe('#diffTime', function() {
    it('should get the difference in time in seconds', function(done) {
      var time = process.hrtime();
      setTimeout(function() {
        var res = utils.diffTime(time);
        res.should.be.greaterThan(0.1);
        res.should.be.lessThan(0.5);
        done();
      }, 100);
    });
  });

  describe('#sendError', function() {
    it('should send a web-style error', function() {
      var err = { statusCode: 500, message: 'hi there', stack: 'some stack' };
      var status = sinon.stub().returnsThis();
      var send = sinon.stub();
      var res = { status: status, send: send };
      utils.sendError(err, res);
      send.should.be.calledOnce;
      status.should.be.calledOnce;
      status.args[0][0].should.equal(500);
      send.args[0][0].should.equal('hi there');
    });

    it('should send a 503 in the case where there is no given status code', function() {
      var err = { message: 'hi there', stack: 'some stack' };
      var status = sinon.stub().returnsThis();
      var send = sinon.stub();
      var res = { status: status, send: send };
      utils.sendError(err, res);
      send.should.be.calledOnce;
      status.should.be.calledOnce;
      status.args[0][0].should.equal(503);
      send.args[0][0].should.equal('hi there');
    });
  });

  describe('#encodeTip', function() {
    it('should encode tip', function() {
      var res = utils.encodeTip({ height: 0xdeadbeef, hash: new Array(65).join('0') }, 'test');
      res.should.deep.equal({
          key: new Buffer('ffff7469702d74657374', 'hex'),
          value: new Buffer('deadbeef00000000000000000000000000000000000000000000000000000000000000000', 'hex')
        });
    });
  });

  describe('#SimpleMap', function() {
    var map = new utils.SimpleMap();

    it('should build a simple map', function() {
      map.should.be.instanceOf(Object);
    });

    it('should set a key and value', function() {
      map.set('key', 'value');
      map.getIndex(0).should.equal('value');
    });

    it('should get a value for key', function() {
      map.get('key').should.equal('value');
    });

    it('should get a get a value at a specific index', function() {
      map.getIndex(0).should.equal('value');
    });

    it('should get the last index', function() {
      map.set('last key', 'last value');
      map.getLastIndex().should.equal('last value');
    });
  });
});
