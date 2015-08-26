#!/usr/bin/env node

'use strict';

var semver = require('semver');
var Liftoff = require('liftoff');
var cliPackage = require('../package.json');

var liftoff = new Liftoff({
  name: 'bitcore-node',
  moduleName: 'bitcore-node',
  configName: 'bitcore-node',
  processTitle: 'bitcore-node'
}).on('require', function (name, module) {
  console.log('Loading:', name);
}).on('requireFail', function (name, err) {
  console.log('Unable to load:', name, err);
}).on('respawn', function (flags, child) {
  console.log('Detected node flags:', flags);
  console.log('Respawned to PID:', child.pid);
});

liftoff.launch({
  cwd: process.cwd()
}, function(env){

  var bitcorenode;
  if (env.modulePackage && env.configPath) {
    // use the local version
    if (semver.gt(cliPackage.version, env.modulePackage.version)) {
      throw new Error(
        'Version mismatch, global bitcore-node is ' + cliPackage.version +
          ' and local bitcore-node is ' + env.modulePackage.version
      );
    }
    bitcorenode = require(env.modulePath);
  } else {
    // use the global version
    bitcorenode = require('..');
  }

  bitcorenode.cli.main();

});
