'use strict';

var execSync = require('child_process').execSync;

function getTarballName() {
  var packageRoot = __dirname + '/..';
  var version = require(packageRoot + '/package.json').version;
  var platform = process.platform;
  var arch = execSync(packageRoot + '/bin/variables.sh arch').toString();
  var abi = process.versions.modules;
  var tarballName = 'libbitcoind-' + version + '-node' + abi + '-' + platform + '-' + arch + '.tgz';
  return tarballName;
}

if (require.main === module) {
  process.stdout.write(getTarballName());
}

module.exports = getTarballName;
