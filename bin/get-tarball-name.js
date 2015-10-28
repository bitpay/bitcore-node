'use strict';

function getTarballName() {
  var packageRoot = __dirname + '/..';
  var version = require(packageRoot + '/package.json').version;
  var platform = process.platform;
  var arch = process.arch;
  var abi = process.versions.modules;
  var tarballName = 'libbitcoind-' + version + '-node' + abi + '-' + platform + '-' + arch + '.tgz';
  return tarballName;
}

if (require.main === module) {
  process.stdout.write(getTarballName());
}

module.exports = getTarballName;
