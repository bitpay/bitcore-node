#!/usr/bin/env node

var bitcoind = require('../')();

bitcoind.on('error', function(err) {
  console.log('bitcoind: error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  console.log('bitcoind: status=%s', status);
});
