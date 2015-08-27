'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var AddressModule = require('../../lib/modules/address');

describe('#start', function() {

  describe('will dynamically create a node from a configuration', function() {

    it('require each bitcore-node module', function(done) {
      var node;
      var TestNode = function(options) {
        options.modules[0].should.deep.equal({
          name: 'address',
          module: AddressModule,
          dependencies: ['bitcoind', 'db']
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
          modules: [
            'address'
          ],
          datadir: './data'
        }
      });
      node.should.be.instanceof(TestNode);
      done();
    });
  });
});
