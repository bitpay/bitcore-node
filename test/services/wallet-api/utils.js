'use strict';

var should = require('chai').should();
var utils = require('../../../lib/services/wallet-api/utils');

describe('Wallet-Api service utils', function() {
  it('should create jsonl from obj', function() {
    var obj = {
      1: 'test',
      'foo bar': 'test1',
      array: [1,2,'test']
    };
    utils.toJSONL(obj).should.equal('{"1":"test","foo bar":"test1","array":[1,2,"test"]}\n');
  });
});
