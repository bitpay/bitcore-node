'use strict';

var sinon = require('sinon');
var FeeService = require('../../../lib/services/fee');

var expect = require('chai').expect;

describe.only('#Fee Service', function() {
  var feeService;
  var sandbox;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    feeService = new FeeService({
      "rpc": {
        "user": "bitcoin",
        "pass": "local321",
        "host": "localhost",
        "protocol": "http",
        "port": 8332
      }
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  /*
    Running in regtest mode or unsync'd will return -1
  */

  it("Has an estimateFee method", function() {
    var method = feeService.getAPIMethods()[0][0];
    expect(method).to.equal('estimateFee');
  })

  it("Can estimate fees", function(done) {
    feeService.estimateFee(4, function(err, fee) {
      expect(err).to.be.a('null');
      expect(fee.result).to.exist;
      expect(fee.result).to.be.at.least(-1);
      done();
    });
  })


});