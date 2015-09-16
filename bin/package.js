'use strict';

var exec = require('child_process').exec;
var bindings = require('bindings');
var index = require('../');
var log = index.log;

var packageRoot = bindings.getRoot(bindings.getFileName());
var binaryPath = bindings({
  path: true,
  bindings: 'bitcoind.node'
});
var relativeBinaryPath = binaryPath.replace(packageRoot + '/', '');
var tarballName = require('./get-tarball-name')();

log.info('Signing binding binary: "' + binaryPath + '"');

var signCommand = 'gpg --yes --out ' + binaryPath + '.sig --detach-sig ' + binaryPath;

var signchild = exec(signCommand, function(error, stdout, stderr) {
  if (error) {
    throw error;
  }

  if (stdout) {
    log.info('GPG:', stdout);
  }

  if (stderr) {
    log.error(stderr);
  }

  log.info('Packaging tarball: "' + tarballName + '"');

  // Create a tarball of both the binding and the signature
  var tarCommand = 'tar -C ' +
    packageRoot + ' -cvzf ' +
    tarballName + ' ' +
    relativeBinaryPath + ' ' +
    relativeBinaryPath + '.sig';

  var tarchild = exec(tarCommand, function (error, stdout, stderr) {

    if (error) {
      throw error;
    }

    if (stdout) {
      log.info('Tar:', stdout);
    }

    if (stderr) {
      log.error(stderr);
    }

  });

});
