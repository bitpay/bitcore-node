#!/usr/bin/env node

'use strict';

var index = require('..');
var log = index.log;

process.title = 'libbitcoind';

/**
 * daemon
 */
var daemon = require('../').services.Bitcoin({
  node: {
    datadir: process.env.BITCORENODE_DIR || process.env.HOME + '/.bitcoin',
    network: {
      name: process.env.BITCORENODE_NETWORK || 'livenet'
    }
  }
});

daemon.start(function() {
  log.info('ready');
});

daemon.on('error', function(err) {
  log.info('error="%s"', err.message);
});

daemon.on('open', function(status) {
  log.info('status="%s"', status);
});

function exitHandler(options, err) {
  log.info('Stopping daemon');
  if (err) {
    log.error('uncaught exception:', err);
    if(err.stack) {
      console.log(err.stack);
    }
    process.exit(-1);
  }
  if (options.sigint) {
    daemon.stop(function(err) {
      if(err) {
        log.error('Failed to stop services: ' + err);
        return process.exit(1);
      }

      log.info('Halted');
      process.exit(0);
    });
  }
}

//catches uncaught exceptions


process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {sigint:true}));
