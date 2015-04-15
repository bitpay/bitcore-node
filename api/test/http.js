'use strict';

var chai = require('chai');
var should = chai.should();

var EventEmitter = require('eventemitter2').EventEmitter2;

var BitcoreHTTP = require('../lib/http');

describe('BitcoreHTTP', function() {

  // mocks
  var opts = {
    BitcoreNode: {
      database: {}
    },
    port: 1234
  };
  var nodeMock;
  beforeEach(function() {
    nodeMock = new EventEmitter();
  });
  describe('instantiates', function() {
    it('from constructor', function() {
      var http = new BitcoreHTTP(nodeMock);
      should.exist(http);
    });
    it('from create', function() {
      var http = new BitcoreHTTP.create(opts);
      should.exist(http);
    });
  });
  it('starts', function() {
    var http = new BitcoreHTTP(nodeMock, opts);
    http.start.bind(http).should.not.throw();
  });

});
