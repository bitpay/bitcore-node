#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

/**
 * bitcoind
 */

var bitcoind = require('../index.js').bitcoind({
  directory: '~/.bitcoin'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('ready', function(err, result) {
  console.log('Ready!');

  bitcoind.getBlock('000000000000000082ccf8f1557c5d40b21edabb18d2d691cfbf87118bac7254', function(err, block) {
    if (err) {
      console.log(err);
    }
    console.log('block', block);
  });

});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
});
