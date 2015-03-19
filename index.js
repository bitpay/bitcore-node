'use strict';

var BitcoreNode = require('./lib/node');
var reporters = require('./lib/reporters');
var bitcore = require('bitcore');

BitcoreNode.errors = require('./lib/errors');

if (require.main === module) {
  var config = require('config');
  bitcore.Networks.defaultNetwork = bitcore.Networks.get(config.network);
  var node = BitcoreNode.create(config.get('BitcoreNode'));
  node.start();
  node.on('error', function(err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('Connection to bitcoind failed');
    } else {
      console.log('Error: ', err);
    }
  });

  var reporterName = config.get('Reporter');
  var reporter = reporters[reporterName];
  if (!reporter) {
    throw new Error('Unrecognized network reporter: ' + reporterName +
      '. Available: ' + Object.keys(reporters));
  }
  node.on('Transaction', reporter);
}



module.exports = BitcoreNode;
