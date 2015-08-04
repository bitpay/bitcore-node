#!/usr/bin/env node

'use strict';

var chainlib = require('chainlib');
var log = chainlib.log;

process.title = 'libbitcoind';

/**
 * daemon
 */
var daemon = require('../').daemon({
  datadir: process.env.BITCORENODE_DIR || '~/.bitcoin',
  network: process.env.BITCORENODE_NETWORK || 'testnet'
});

daemon.on('ready', function() {
  log.info('ready');
});

daemon.on('error', function(err) {
  log.info('error="%s"', err.message);
});

daemon.on('open', function(status) {
  log.info('status="%s"', status);
});
