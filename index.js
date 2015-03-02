'use strict';

var config = require('config');

var BitcoreNode = require('./lib/node.js');

if (require.main === module) {
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

module.exports = BitcoreNode;
