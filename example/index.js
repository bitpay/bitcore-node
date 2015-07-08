#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

/**
 * bitcoind
 */
var bitcoindjsConf = process.env('BITCOINDJS_DIR');

var bitcoind = require('../')({
  directory: '~/.libbitcoind-example'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
});
