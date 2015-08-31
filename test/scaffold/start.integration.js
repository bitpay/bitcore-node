'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var AddressService = require('../../lib/services/address');

describe('#start', function() {

  describe('will dynamically create a node from a configuration', function() {

    it('require each bitcore-node service with default config', function(done) {
      var node;
      var TestNode = function(options) {
        options.services[0].should.deep.equal({
          name: 'address',
          module: AddressService,
          dependencies: ['bitcoind', 'db'],
          config: {}
        });
      };
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
            'address'
          ],
          datadir: './data'
        }
      });
      node.should.be.instanceof(TestNode);
      done();
    });

    it('require each bitcore-node service with explicit config', function(done) {
      var node;
      var TestNode = function(options) {
        options.services[0].should.deep.equal({
          name: 'address',
          module: AddressService,
          dependencies: ['bitcoind', 'db'],
          config: {
            param: 'test'
          }
        });
      };
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
            {
              name: 'address',
              config: {
                param: 'test'
              }
            }
          ],
          datadir: './data'
        }
      });
      node.should.be.instanceof(TestNode);
      done();
    });
  });
});
