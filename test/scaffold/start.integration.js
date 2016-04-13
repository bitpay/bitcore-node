'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var BitcoinService = require('../../lib/services/bitcoind');

describe('#start', function() {

  describe('will dynamically create a node from a configuration', function() {

    it('require each bitcore-node service with default config', function(done) {
      var node;
      var TestNode = function(options) {
        options.services[0].should.deep.equal({
          name: 'bitcoind',
          module: BitcoinService,
          config: {}
        });
      };
      TestNode.prototype.start = sinon.stub().callsArg(0);
      TestNode.prototype.on = sinon.stub();
      TestNode.prototype.chain = {
        on: sinon.stub()
      };

      var starttest = proxyquire('../../lib/scaffold/start', {
        '../node': TestNode
      });

      node = starttest({
        path: __dirname,
        config: {
          services: [
            'bitcoind'
          ],
          datadir: './data'
        }
      });
      node.should.be.instanceof(TestNode);
      done();
    });
    it('shutdown with an error from start', function(done) {
      var TestNode = proxyquire('../../lib/node', {});
      TestNode.prototype.start = function(callback) {
        setImmediate(function() {
          callback(new Error('error'));
        });
      };
      var starttest = proxyquire('../../lib/scaffold/start', {
        '../node': TestNode
      });
      starttest.cleanShutdown = sinon.stub();
      starttest({
        path: __dirname,
        config: {
          services: [],
          datadir: './testdir'
        }
      });
      setImmediate(function() {
        starttest.cleanShutdown.callCount.should.equal(1);
        done();
      });
    });
    it('require each bitcore-node service with explicit config', function(done) {
      var node;
      var TestNode = function(options) {
        options.services[0].should.deep.equal({
          name: 'bitcoind',
          module: BitcoinService,
          config: {
            param: 'test'
          }
        });
      };
      TestNode.prototype.start = sinon.stub().callsArg(0);
      TestNode.prototype.on = sinon.stub();
      TestNode.prototype.chain = {
        on: sinon.stub()
      };

      var starttest = proxyquire('../../lib/scaffold/start', {
        '../node': TestNode
      });

      node = starttest({
        path: __dirname,
        config: {
          services: [
            'bitcoind'
          ],
          servicesConfig: {
            'bitcoind': {
              param: 'test'
            }
          },
          datadir: './data'
        }
      });
      node.should.be.instanceof(TestNode);
      done();
    });
  });
});
