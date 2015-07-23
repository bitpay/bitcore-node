'use strict';

var BitcoindJS = require('..');
var BitcoinNode = BitcoindJS.Node;
var chainlib = require('chainlib');
var log = chainlib.log;
log.debug = function() {};

var configuration = {
  datadir: process.env.BITCOINDJS_DIR || '~/.bitcoin'
};

var node = new BitcoinNode(configuration);

var count = 0;
var interval;

node.on('ready', function() {
  interval = setInterval(function() {
    log.info('Sync Status: Tip:', node.chain.tip.hash, 'Height:', node.chain.tip.__height, 'Rate:', count/10, 'blocks per second');
    count = 0;
  }, 10000);
});

node.on('error', function(err) {
  log.error(err);
});

node.chain.on('addblock', function(block) {
  count++;
});
