'use strict';

var Liftoff = require('liftoff');

function main(parentServicesPath, additionalServices) {

  var liftoff = new Liftoff({
    name: 'bitcore',
    moduleName: 'bitcore-node',
    configName: 'bitcore-node',
    processTitle: 'bitcore'
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
    if (typeof env.modulePath === 'undefined') {
      node = require('../../');
      node.cli.main(parentServicesPath, additionalServices);
    } else {
      node = require(env.modulePath);
      node.cli.main();
    }

  });

}

module.exports = main;
