'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var path = require('path');
var fs = require('fs');
var proxyquire = require('proxyquire');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var add = require('../../lib/scaffold/add');

describe('#add', function() {

  var basePath = path.resolve(__dirname, '..');
  var testDir = path.resolve(basePath, 'temporary-test-data');
  var startConfig = {
    name: 'My Node',
    modules: []
  };
  var startPackage = {};

  before(function(done) {
    mkdirp(testDir + '/s0/s1', function(err) {
      if (err) {
        throw err;
      }
      fs.writeFile(
        testDir + '/s0/s1/bitcore-node.json',
        JSON.stringify(startConfig),
        function(err) {
          if (err) {
            throw err;
          }
          fs.writeFile(
            testDir + '/s0/s1/package.json',
            JSON.stringify(startPackage),
            done
          );
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

  describe('will modify scaffold files', function() {

    it('will give an error if expected files do not exist', function(done) {
      add({
        path: path.resolve(testDir, 's0'),
        modules: ['a', 'b', 'c']
      }, function(err) {
        should.exist(err);
        err.message.match(/^Invalid state/);
        done();
      });
    });

    it('will receive error from `npm install`', function(done) {
      var spawn = sinon.stub().returns({
        stdout: {
          on: sinon.stub()
        },
        stderr: {
          on: sinon.stub()
        },
        on: sinon.stub().callsArgWith(1, 1)
      });
      var addtest = proxyquire('../../lib/scaffold/add', {
        'child_process': {
          spawn: spawn
        }
      });

      addtest({
        path: path.resolve(testDir, 's0/s1/'),
        modules: ['a', 'b', 'c']
      }, function(err) {
        should.exist(err);
        err.message.should.equal('There was an error installing module: a');
        done();
      });
    });

    it('will update bitcore-node.json modules', function(done) {
      var spawn = sinon.stub().returns({
        stdout: {
          on: sinon.stub()
        },
        stderr: {
          on: sinon.stub()
        },
        on: sinon.stub().callsArgWith(1, 0)
      });
      var addtest = proxyquire('../../lib/scaffold/add', {
        'child_process': {
          spawn: spawn
        }
      });
      addtest({
        path: path.resolve(testDir, 's0/s1/'),
        modules: ['a', 'b', 'c']
      }, function(err) {
        should.not.exist(err);
        var configPath = path.resolve(testDir, 's0/s1/bitcore-node.json');
        var config = JSON.parse(fs.readFileSync(configPath));
        config.modules.should.deep.equal(['a','b','c']);
        done();
      });
    });

  });

});
