'use strict';

var should = require('chai').should();
var index = require('..');

describe('Index', function() {
  describe('#nodeVersionCheck', function() {
    it('will throw informative error message with incompatible Node.js version 4.1.2', function() {
      (function() {
        index.nodeVersionCheck('4.1.2', '>=0.12.0 <1');
      }).should.throw('Node.js version');
    });
    it('will throw informative error message with incompatible Node.js version 0.10.40', function() {
      (function() {
        index.nodeVersionCheck('4.1.2', '>=0.12.0 <1');
      }).should.throw('Node.js version');
    });
  });
});
