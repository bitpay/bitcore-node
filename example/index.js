#!/usr/bin/env node

'use strict';

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

/**
 * bitcoind
 */

var bitcoind = require('../')({
  directory: process.env.BITCOINDJS_DIR || '~/.bitcoin'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
});
