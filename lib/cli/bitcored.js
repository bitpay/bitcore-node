'use strict';

var Liftoff = require('liftoff');

function main() {

  var liftoff = new Liftoff({
    name: 'bitcored',
    moduleName: 'bitcore-node',
    configName: 'bitcore-node',
    processTitle: 'bitcored'
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

    var node;
    if (env.modulePackage && env.configPath) {
      // use the configured version
      node = require(env.modulePath);
    } else {
      // use this version
      node = require('..');
    }

    node.cli.daemon();

  });

}

module.exports = main;
