'use strict';

var should = require('chai').should();
var create = require('../../lib/scaffold/create');
var fs = require('fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');

describe('#create', function() {

  var basePath = __dirname + '/../';
  var testDir = basePath + 'temporary-test-data';

  before(function(done) {
    // setup testing directories
    mkdirp(testDir, function(err) {
      if (err) {
        throw err;
      }
      done();
    });
  });

  after(function(done) {
    // cleanup testing directories
    rimraf(testDir, function(err) {
      if (err) {
        throw err;
      }
      done();
    });
  });

  it('will create scaffold files', function() {

    create(testDir, 'mynode', 'My Node 1', function(err) {
      if (err) {
        throw err;
      }

      var configPath = testDir + '/mynode/bitcore-node.json';
      var packagePath = testDir + '/mynode/package.json';
      var bitcoinConfig = testDir + '/mynode/data/bitcoin.conf';

      should.equal(fs.existsSync(configPath), true);
      should.equal(fs.existsSync(packagePath), true);
      should.equal(fs.existsSync(bitcoinConfig), true);

      var config = JSON.parse(fs.readFileSync(configPath));
      config.name.should.equal('My Node 1');
      config.modules.should.deep.equal(['address']);
      config.datadir.should.equal('./data');
      config.network.should.equal('livenet');

      var pack = JSON.parse(fs.readFileSync(packagePath));
      should.exist(pack.dependencies);

    });

  });

});
