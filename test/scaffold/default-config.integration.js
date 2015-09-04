'use strict';

var should = require('chai').should();
var defaultConfig = require('../../lib/scaffold/default-config');

describe('#defaultConfig', function() {

  it('will return expected configuration', function() {
    var cwd = process.cwd();
    delete process.env.BITCORENODE_DIR;
    delete process.env.BITCORENODE_NETWORK;
    delete process.env.BITCORENODE_PORT;
    var home = process.env.HOME;
    var info = defaultConfig();
    info.path.should.equal(cwd);
    info.config.datadir.should.equal(home + '/.bitcoin');
    info.config.network.should.equal('livenet');
    info.config.port.should.equal(3001);
    info.config.services.should.deep.equal(['bitcoind', 'db', 'address', 'web']);
  });

  it('will return expected configuration from environment variables', function() {
    var cwd = process.cwd();
    process.env.BITCORENODE_DIR = '/home/bitcore-node/.bitcoin';
    process.env.BITCORENODE_NETWORK = 'testnet';
    process.env.BITCORENODE_PORT = 3002;
    var info = defaultConfig();
    info.path.should.equal(cwd);
    info.config.datadir.should.equal('/home/bitcore-node/.bitcoin');
    info.config.network.should.equal('testnet');
    info.config.port.should.equal(3002);
    info.config.services.should.deep.equal(['bitcoind', 'db', 'address', 'web']);
  });

});
