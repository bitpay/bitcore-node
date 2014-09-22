#!/usr/bin/env node

process.title = 'bitcoind.js';

var util = require('util');
var bitcoind = require('../')();

var genesisBlock = '0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
var genesisTx = '0x4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

bitcoind.start(function(err) {
  bitcoind.on('error', function(err) {
    console.log('bitcoind: error="%s"', err.message);
  });
  bitcoind.on('open', function(status) {
    console.log('bitcoind: status="%s"', status);
    return setTimeout(function() {
      // return bitcoind.getTx(genesisTx, genesisBlock, function(err, tx) {
      return bitcoind.getTx(genesisTx, function(err, tx) {
        if (err) throw err;
        return print(tx);
      });
    }, 1000);
    setTimeout(function() {
      (function next(hash) {
        return bitcoind.getBlock(hash, function(err, block) {
          if (err) return console.log(err.message);
          print(block);
          if (process.argv[2] === '-r' && block.nextblockhash) {
            setTimeout(next.bind(null, block.nextblockhash), 200);
          }
        });
      })(genesisBlock);
    }, 1000);
  });
});

function inspect(obj) {
  return util.inspect(obj, null, 20, true);
}

function print(obj) {
  return process.stdout.write(inspect(obj) + '\n');
}
