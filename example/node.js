'use strict';

var BitcoindJS = require('..');
var BitcoinNode = BitcoindJS.Node;
var chainlib = require('chainlib');
var log = chainlib.log;
//log.debug = function() {};

var privkey = 'tprv8ZgxMBicQKsPdj1QowoT9z1tY5Et38qaMjCHZVoPdPFb6narfmYkqTygEVHfUmY78k3HcaEpkyNCAQDANaXtwNe1HLFvcA7nqYj1B7wTSTo';

var configuration = {
  db: {
    xprivkey: privkey,
    path: './bitcoind.db'
  },
  p2p: {
    addrs: [
      {
        ip: {
          v4: '127.0.0.1'
        },
        port: 8333
      }
    ],
    dnsSeed: false
  },
  testnet: false
};

var node = new BitcoinNode(configuration);

var startHeight;
var count = 100;
var times = Array(count);

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