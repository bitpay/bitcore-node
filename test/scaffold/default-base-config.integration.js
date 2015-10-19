'use strict';

var should = require('chai').should();
var defaultBaseConfig = require('../../lib/scaffold/default-base-config');

describe('#defaultConfig', function() {
  it('will return expected configuration', function() {
    var cwd = process.cwd();
    var home = process.env.HOME;
    var info = defaultBaseConfig();
    info.path.should.equal(cwd);
    info.config.datadir.should.equal(home + '/.bitcoin');
    info.config.network.should.equal('livenet');
    info.config.port.should.equal(3001);
    info.config.services.should.deep.equal(['bitcoind', 'db', 'address', 'web']);
  });
});
