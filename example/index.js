#!/usr/bin/env node

var bitcoind = require('../')();

bitcoind.on('open', function(status) {
  console.log('bitcoind: ' + status);
});
