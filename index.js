'use strict';

var BitcoreNode = require('./lib/node');
var reporters = require('./lib/reporters');
var bitcore = require('bitcore');
var Promise = require('bluebird');
Promise.longStackTraces();

BitcoreNode.errors = require('./lib/errors');

if (require.main === module) {
  var config = require('config');
  var network = config.get('BitcoreNode').network;
  console.log('Starting bitcore-node', network, 'network');
  bitcore.Networks.defaultNetwork = bitcore.Networks.get(network);

  var node = BitcoreNode.create(config.get('BitcoreNode'));
  node.start();
  node.on('error', function(err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('Connection to bitcoind failed');
    } else {
      console.log('Error: ', err);
    }
  });
  process.on('SIGINT', function() {
    node.stop();
    process.exit();
  });

  var reporterName = config.get('BitcoreNode.Reporter');
  var reporter = reporters[reporterName];
  if (!reporter) {
    throw new Error('Unrecognized network reporter: ' + reporterName +
      '. Available: ' + Object.keys(reporters));
  }
  node.on('Transaction', reporter);
}

module.exports = BitcoreNode;
