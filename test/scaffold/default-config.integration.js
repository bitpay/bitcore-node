'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');

describe('#defaultConfig', function() {
  it('will return expected configuration', function() {
    var config = JSON.stringify({
      datadir: process.env.HOME + '/.bitcore/data',
      network: 'livenet',
      port: 3001,
      services: [
        'bitcoind',
        'db',
        'address',
        'web'
      ]
    }, null, 2);
    var defaultConfig = proxyquire('../../lib/scaffold/default-config', {
      fs: {
        existsSync: sinon.stub().returns(false),
        writeFileSync: function(path, data) {
          path.should.equal(process.env.HOME + '/.bitcore/bitcore-node.json');
          data.should.equal(config);
        },
        readFileSync: function() {
          return config;
        }
      },
      mkdirp: {
        sync: sinon.stub()
      }
    });
    var cwd = process.cwd();
    var home = process.env.HOME;
    var info = defaultConfig();
    info.path.should.equal(home + '/.bitcore');
    info.config.datadir.should.equal(home + '/.bitcore/data');
    info.config.network.should.equal('livenet');
    info.config.port.should.equal(3001);
    info.config.services.should.deep.equal(['bitcoind', 'db', 'address', 'web']);
  });
  it('will include additional services', function() {
    var config = JSON.stringify({
      datadir: process.env.HOME + '/.bitcore/data',
      network: 'livenet',
      port: 3001,
      services: [
        'bitcoind',
        'db',
        'address',
        'web',
        'insight-api',
        'insight-ui'
      ]
    }, null, 2);
    var defaultConfig = proxyquire('../../lib/scaffold/default-config', {
      fs: {
        existsSync: sinon.stub().returns(false),
        writeFileSync: function(path, data) {
          path.should.equal(process.env.HOME + '/.bitcore/bitcore-node.json');
          data.should.equal(config);
        },
        readFileSync: function() {
          return config;
        }
      },
      mkdirp: {
        sync: sinon.stub()
      }
    });
    var home = process.env.HOME;
    var info = defaultConfig({
      additionalServices: ['insight-api', 'insight-ui']
    });
    info.path.should.equal(home + '/.bitcore');
    info.config.datadir.should.equal(home + '/.bitcore/data');
    info.config.network.should.equal('livenet');
    info.config.port.should.equal(3001);
    info.config.services.should.deep.equal([
      'bitcoind',
      'db',
      'address',
      'web',
      'insight-api',
      'insight-ui'
    ]);
  });
});
