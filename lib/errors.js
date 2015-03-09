'use strict';

var spec = {
  name: 'BitcoreNode',
  message: 'Internal Error on BitcoreNode',
  errors: [{
    name: 'Transactions',
    message: 'Internal Transactions error on BitcoreNode',
    errors: [{
      name: 'NotFound',
      message: 'Transaction {0} not found'
    }, {
      name: 'CantBroadcast',
      message: 'Unable to broadcast transaction {0}'
    }]
  }, {
    name: 'Blocks',
    message: 'Internal Blocks error on BitcoreNode',
    errors: [{
      name: 'NotFound',
      message: 'Block {0} not found'
    }]
  }]
};

module.exports = require('bitcore').errors.extend(spec);
