'use strict';

var sinon = require('sinon');
var chai = require('chai');
var should = chai.should();
var Logger = require('../lib/logger');

describe('Logger', function() {
  var sandbox = sinon.sandbox.create();
  afterEach(function() {
    sandbox.restore();
  });

  it('will instatiate without options', function() {
    var logger = new Logger();
    should.exist(logger);
    logger.formatting.should.equal(true);
  });

  it('will instatiate with formatting option', function() {
    var logger = new Logger({
      formatting: false
    });
    logger.formatting.should.equal(false);
    var logger2 = new Logger({
      formatting: true
    });
    logger2.formatting.should.equal(true);
  });

  it('will log with formatting', function() {
    var logger = new Logger({formatting: true});

    sandbox.stub(console, 'info');
    logger.info('Test info log');
    console.info.callCount.should.equal(1);
    console.info.restore();

    sandbox.stub(console, 'error');
    logger.error(new Error('Test error log'));
    console.error.callCount.should.equal(1);
    console.error.restore();

    sandbox.stub(console, 'log');
    logger.debug('Test debug log');
    console.log.callCount.should.equal(1);
    console.log.restore();

    sandbox.stub(console, 'warn');
    logger.warn('Test warn log');
    console.warn.callCount.should.equal(1);
    console.warn.restore();
  });

  it('will log without formatting', function() {
    var logger = new Logger({formatting: false});

    sandbox.stub(console, 'info');
    logger.info('Test info log');
    console.info.callCount.should.equal(1);
    should.not.exist(console.info.args[0][0].match(/^\[/));
    console.info.restore();

    sandbox.stub(console, 'error');
    logger.error(new Error('Test error log'));
    console.error.callCount.should.equal(1);
    console.error.args[0][0].should.be.instanceof(Error);
    console.error.restore();

    sandbox.stub(console, 'log');
    logger.debug('Test debug log');
    console.log.callCount.should.equal(1);
    should.equal(console.log.args[0][0].match(/^\[/), null);
    console.log.restore();

    sandbox.stub(console, 'warn');
    logger.warn('Test warn log');
    console.warn.callCount.should.equal(1);
    should.equal(console.warn.args[0][0].match(/^\[/), null);
    console.warn.restore();
  });

});
