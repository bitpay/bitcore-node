#!/usr/bin/env node

'use strict';

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

/**
 * daemon
 */
var daemon = require('../').daemon({
  datadir: process.env.BITCOINDJS_DIR || '~/.bitcoin',
});

daemon.on('ready', function() {
  console.log('ready');
});

daemon.on('tx', function(txid) {
  console.log('txid', txid);
});

daemon.on('error', function(err) {
  daemon.log('error="%s"', err.message);
});

daemon.on('open', function(status) {
  daemon.log('status="%s"', status);
});
