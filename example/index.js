#!/usr/bin/env node

process.title = 'bitcoind.js';

var util = require('util');
var bitcoind = require('../')();

bitcoind.start(function(err) {
  bitcoind.on('error', function(err) {
    console.log('bitcoind: error="%s"', err.message);
  });
  bitcoind.on('open', function(status) {
    setTimeout(function() {
      var genesis = '0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
      return bitcoind.getBlock(genesis, function(err, block) {
        if (err) return console.log(err.message);
        print(block);
      });
    }, 1000);
    console.log('bitcoind: status="%s"', status);
  });
});

function inspect(obj) {
  return util.inspect(obj, null, 20, true);
}

function print(obj) {
  return process.stdout.write(inspect(obj) + '\n');
}
