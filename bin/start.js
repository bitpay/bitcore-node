'use strict';

var start = require('../lib/scaffold/start');
var path = require('path');

start({
  path: process.cwd(),
  config: {
    datadir: process.env.BITCORENODE_DIR || path.resolve(process.env.HOME, '.bitcoin'),
    network: process.env.BITCORENODE_NETWORK || 'livenet',
    port: process.env.BITCORENODE_PORT || 3001
  }
});

node.on('stopping', function() {
  clearInterval(interval);
});

function exitHandler(options, err) {
  if (err) {
    log.error('uncaught exception:', err);
    if(err.stack) {
      console.log(err.stack);
    }
    process.exit(-1);
  }
  if (options.sigint) {
    node.stop(function(err) {
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
