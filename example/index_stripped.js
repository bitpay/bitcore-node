#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind_stripped.js';

/**
 * daemon
 */

var daemon = require('../index_stripped.js')({
  directory: '~/.libbitcoind-example'
});

daemon.on('error', function(err) {
  daemon.log('error="%s"', err.message);
});

daemon.on('open', function(status) {
  daemon.log('status="%s"', status);
});
