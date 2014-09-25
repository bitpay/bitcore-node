#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

var util = require('util');
var argv = require('optimist').argv;

/**
 * bitcoind
 */

var bitcoind = require('../')();

var genesisBlock = '0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
var genesisTx = '0x4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

bitcoind.on('error', function(err) {
  print('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  print('status="%s"', status);

  if (argv.blocks) {
    getBlocks(bitcoind);
  }

  if (argv['on-block']) {
    bitcoind.on('block', function(block) {
      print('Found Block:');
      print(block);
    });
  }

  if (argv['on-tx']) {
    bitcoind.on('tx', function(tx) {
      print('Found TX:');
      print(tx);
    });
    bitcoind.on('mptx', function(mptx) {
      print('Found mempool TX:');
      print(mptx);
    });
  }

  if (argv.broadcast) {
    bitcoind.once('tx', function(tx) {
      print('Broadcasting TX...');
      return tx.broadcast(function(err, hash, tx) {
        if (err) throw err;
        print('TX Hash: %s', hash);
        print(tx);
      });
    });
  }
});

/**
 * Helpers
 */

function getBlocks(bitcoind) {
  return setTimeout(function() {
    return (function next(hash) {
      return bitcoind.getBlock(hash, function(err, block) {
        if (err) return print(err.message);

        print(block);

        if (argv['get-tx'] && block.tx.length && block.tx[0].txid) {
          var txid = block.tx[0].txid;
          // XXX Dies with a segfault
          // bitcoind.getTx(txid, hash, function(err, tx) {
          bitcoind.getTx(txid, function(err, tx) {
            if (err) return print(err.message);
            print('TX -----------------------------------------------------');
            print(tx);
            print('/TX ----------------------------------------------------');
          });
        }

        if (argv.all && block.nextblockhash) {
          setTimeout(next.bind(null, block.nextblockhash), 500);
        }
      });
    })(genesisBlock);
  }, 1000);
}

function inspect(obj) {
  return util.inspect(obj, null, 20, true);
}

function print(obj) {
  if (typeof obj === 'string') {
    return process.stdout.write(
      'bitcoind.js: '
      + util.format.apply(util, arguments)
      + '\n');
  }
  return process.stdout.write(inspect(obj) + '\n');
}
