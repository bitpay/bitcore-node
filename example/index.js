#!/usr/bin/env node

var bitcoind = require('../')();

bitcoind.start(function(err) {
  bitcoind.on('error', function(err) {
    console.log('bitcoind: error="%s"', err.message);
  });
  bitcoind.on('open', function(status) {
    console.log('bitcoind: status="%s"', status);
  });
});

process.on('SIGINT', function() {
  return bitcoind.stop(function(err) {
    if (err) throw err;
    return process.exit(0);
  });
});
