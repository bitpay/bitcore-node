'use strict';

var should = require('chai').should();
var utils = require('../lib/utils');

describe('Utils', function() {

  describe('#isHash', function() {

    it('false for short string', function() {
      var a = utils.isHash('ashortstring');
      a.should.equal(false);
    });

    it('false for long string', function() {
      var a = utils.isHash('00000000000000000000000000000000000000000000000000000000000000000');
      a.should.equal(false);
    });

    it('false for correct length invalid char', function() {
      var a = utils.isHash('z000000000000000000000000000000000000000000000000000000000000000');
      a.should.equal(false);
    });

    it('false for invalid type (buffer)', function() {
      var a = utils.isHash(new Buffer('abcdef', 'hex'));
      a.should.equal(false);
    });

    it('false for invalid type (number)', function() {
      var a = utils.isHash(123456);
      a.should.equal(false);
    });

    it('true for hash', function() {
      var a = utils.isHash('fc63629e2106c3440d7e56751adc8cfa5266a5920c1b54b81565af25aec1998b');
      a.should.equal(true);
    });

  });

  describe('#isSafeNatural', function() {

    it('false for float', function() {
      var a = utils.isSafeNatural(0.1);
      a.should.equal(false);
    });

    it('false for string float', function() {
      var a = utils.isSafeNatural('0.1');
      a.should.equal(false);
    });

    it('false for string integer', function() {
      var a = utils.isSafeNatural('1');
      a.should.equal(false);
    });

    it('false for negative integer', function() {
      var a = utils.isSafeNatural(-1);
      a.should.equal(false);
    });

    it('false for negative integer string', function() {
      var a = utils.isSafeNatural('-1');
      a.should.equal(false);
    });

    it('false for infinity', function() {
      var a = utils.isSafeNatural(Infinity);
      a.should.equal(false);
    });

    it('false for NaN', function() {
      var a = utils.isSafeNatural(NaN);
      a.should.equal(false);
    });

    it('false for unsafe number', function() {
      var a = utils.isSafeNatural(Math.pow(2, 53));
      a.should.equal(false);
    });

    it('true for positive integer', function() {
      var a = utils.isSafeNatural(1000);
      a.should.equal(true);
    });

  });

  describe('#startAtZero', function() {

    it('will set key to zero if not set', function() {
      var obj = {};
      utils.startAtZero(obj, 'key');
      obj.key.should.equal(0);
    });

    it('not if already set', function() {
      var obj = {
        key: 10
      };
      utils.startAtZero(obj, 'key');
      obj.key.should.equal(10);
    });

    it('not if set to false', function() {
      var obj = {
        key: false
      };
      utils.startAtZero(obj, 'key');
      obj.key.should.equal(false);
    });

    it('not if set to undefined', function() {
      var obj = {
        key: undefined
      };
      utils.startAtZero(obj, 'key');
      should.equal(obj.key, undefined);
    });

    it('not if set to null', function() {
      var obj = {
        key: null
      };
      utils.startAtZero(obj, 'key');
      should.equal(obj.key, null);
    });

  });

  describe('#parseParamsWithJSON', function() {
    it('will parse object', function() {
      var paramsArg = ['3CMNFxN1oHBc4R1EpboAL5yzHGgE611Xou', '{"start": 100, "end": 1}'];
      var params = utils.parseParamsWithJSON(paramsArg);
      params.should.deep.equal(['3CMNFxN1oHBc4R1EpboAL5yzHGgE611Xou', {start: 100, end: 1}]);
    });
    it('will parse array', function() {
      var paramsArg = ['3CMNFxN1oHBc4R1EpboAL5yzHGgE611Xou', '[0, 1]'];
      var params = utils.parseParamsWithJSON(paramsArg);
      params.should.deep.equal(['3CMNFxN1oHBc4R1EpboAL5yzHGgE611Xou', [0, 1]]);
    });
    it('will parse numbers', function() {
      var paramsArg = ['3', 0, 'b', '0', 0x12, '0.0001'];
      var params = utils.parseParamsWithJSON(paramsArg);
      params.should.deep.equal([3, 0, 'b', 0, 0x12, 0.0001]);
    });
  });

});
