'use strict';

var BitcoindJS = require('..');
var BitcoinNode = BitcoindJS.Node;
var chainlib = require('chainlib');
var log = chainlib.log;
//log.debug = function() {};

var configuration = {
  datadir: process.env.BITCOINDJS_DIR || '~/.bitcoin',
  testnet: true
};

var node = new BitcoinNode(configuration);

var startHeight;
var count = 100;
var times = new Array(count);

node.on('ready', function() {
  times[node.chain.tip.__height % count] = Date.now();
  startHeight = node.chain.tip.__height;
});

node.on('error', function(err) {
  log.error(err);
});

node.chain.on('addblock', function(block) {
  console.log('New Best Tip:', block.hash);
  var startTime = times[node.chain.tip.__height % count];

  if(startTime) {
    var timeElapsed = (Date.now() - startTime) / 1000;
    console.log(Math.round(count / timeElapsed) + ' blocks per second');
  }

  times[node.chain.tip.__height % count] = Date.now();
});
