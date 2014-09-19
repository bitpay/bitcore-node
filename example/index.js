#!/usr/bin/env node

process.title = 'bitcoind.js';

var bitcoind = require('../')();

bitcoind.start(function(err) {
  bitcoind.on('error', function(err) {
    console.log('bitcoind: error="%s"', err.message);
  });
  bitcoind.on('open', function(status) {
    setTimeout(function() {
      var block = bitcoind.getBlock(0);
      console.log(block);
    }, 1000);
    console.log('bitcoind: status="%s"', status);
  });
});
