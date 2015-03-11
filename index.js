'use strict';


var BitcoreNode = require('./lib/node');

if (require.main === module) {
  var config = require('config');
  var node = BitcoreNode.create(config.get('BitcoreNode'));
  node.start();
}


BitcoreNode.errors = require('./lib/errors');

module.exports = BitcoreNode;
