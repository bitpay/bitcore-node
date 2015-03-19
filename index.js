'use strict';

var BitcoreNode = require('./lib/node');
var reporters = require('./lib/reporters');

if (require.main === module) {
  var config = require('config');
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


BitcoreNode.errors = require('./lib/errors');

module.exports = BitcoreNode;
