'use strict';

var bindings = require('bindings');
var packageRoot = bindings.getRoot(bindings.getFileName());
var version = require(packageRoot + '/package.json').version;
var platform = process.platform;
var arch = process.arch;
var tarballName = 'libbitcoind-' + version + '-' + platform + '-' + arch + '.tgz';

if (require.main === module) {
  process.stdout.write(tarballName);
}
