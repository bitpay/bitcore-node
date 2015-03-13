'use strict';


var BitcoreNode = require('./lib/node');

if (require.main === module) {
  var config = require('config');
  var node = BitcoreNode.create(config.get('BitcoreNode'));
  node.start();
  node.on('error', function(err) {
    if (err.code === 'ECONNREFUSED') {
      console.log('Connection to bitcoind failed');
    } else {
      console.log('Unrecognized error: ', err);
    }
  });
}


BitcoreNode.errors = require('./lib/errors');

module.exports = BitcoreNode;
