'use strict';

var sinon = require('sinon');
var FeeService = require('../../../lib/services/fee');
var expect = require('chai').expect;

describe('#Fee Service', function() {

  var feeService;
  var sandbox;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    feeService = new FeeService({
      rpc: {
        user: 'bitcoin',
        pass: 'local321',
        host: 'localhost',
        protocol: 'http',
        port: 8332
      }
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  /*
    Running in regtest mode or unsync'd will return -1
  */

  it('Has an estimateFee method', function() {
    var method = feeService.getAPIMethods()[0][0];
    expect(method).to.equal('estimateFee');
  });

  it('Can estimate fees', function(done) {
    var estimateFee = sinon.stub().callsArgWith(1, null, { result: 0.1 });
    feeService._client = { estimateFee: estimateFee };
    feeService.estimateFee(4, function(err, fee) {

      if (err) {
        return done(err);
      }

      expect(fee).to.equal(0.1);
      done();

    });
  });


});
