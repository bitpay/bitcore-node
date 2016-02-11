'use strict';

var should = require('chai').should();
var path = require('path');
var getTarballName = require('../../bin/get-tarball-name');
var execSync = require('child_process').execSync;

describe('#getTarballName', function() {
  it('will return the expected tarball name', function() {
    var name = getTarballName();
    var version = require(path.resolve(__dirname + '../../../package.json')).version;
    var platform = process.platform;
    var arch = execSync(path.resolve(__dirname) + '/../../bin/variables.sh arch');
    var abi = process.versions.modules;
    var expected = 'libbitcoind-' + version + '-node' + abi + '-' + platform + '-' + arch + '.tgz';
    name.should.equal(expected);
  });
});
