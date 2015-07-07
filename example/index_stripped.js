#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind_stripped.js';

/**
 * bitcoind
 */

var bitcoind = require('../index_stripped.js')({
  directory: '~/.libbitcoind-example'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
});
