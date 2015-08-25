'use strict';

var fs = require('fs');
var path = require('path');
var should = require('chai').should();
var sinon = require('sinon');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');

var findConfig = require('../../lib/scaffold/find-config');

describe('#findConfig', function() {

  var testDir = path.resolve(__dirname, '../temporary-test-data');
  var expectedConfig = {
    name: 'My Node'
  };

  before(function(done) {
    // setup testing directories
    mkdirp(testDir + '/p2/p1/p0', function(err) {
      if (err) {
        throw err;
      }
      fs.writeFile(
        testDir + '/p2/bitcore-node.json',
        JSON.stringify(expectedConfig),
        function() {
          mkdirp(testDir + '/e0', function(err) {
            if (err) {
              throw err;
            }
            done();
          });
        }
      );
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


  describe('will find a configuration file', function() {

    it('in the current directory', function() {
      var config = findConfig(path.resolve(testDir, 'p2'));
      config.path.should.equal(path.resolve(testDir, 'p2'));
      config.config.should.deep.equal(expectedConfig);
    });

    it('in a parent directory', function() {
      var config = findConfig(path.resolve(testDir,  'p2/p1'));
      config.path.should.equal(path.resolve(testDir, 'p2'));
      config.config.should.deep.equal(expectedConfig);
    });

    it('recursively find in parent directories', function() {
      var config = findConfig(path.resolve(testDir,  'p2/p1/p0'));
      config.path.should.equal(path.resolve(testDir, 'p2'));
      config.config.should.deep.equal(expectedConfig);
    });

  });

  it('will return false if missing a configuration', function() {
    var config = findConfig(path.resolve(testDir,  'e0'));
    config.should.equal(false);
  });

});
