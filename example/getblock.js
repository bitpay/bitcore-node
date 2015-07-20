#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

/**
 * daemon
 */

var daemon = require('../index.js').daemon({
  directory: process.env.BITCOINDJS_DIR || '~/.bitcoin'
});

daemon.on('error', function(err) {
  daemon.log('error="%s"', err.message);
});

daemon.on('ready', function(err, result) {
  console.log('Ready!');

  daemon.getBlock('000000000000000082ccf8f1557c5d40b21edabb18d2d691cfbf87118bac7254', function(err, block) {
    if (err) {
      console.log(err);
    }
    console.log('block', block);
  });

});

daemon.on('open', function(status) {
  daemon.log('status="%s"', status);
});
