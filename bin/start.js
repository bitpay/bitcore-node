'use strict';

var start = require('../lib/scaffold/start');

start({
  path: process.cwd(),
  config: {
    datadir: process.env.BITCORENODE_DIR || '~/.bitcoin',
    network: process.env.BITCORENODE_NETWORK || 'livenet',
    port: 3000
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
