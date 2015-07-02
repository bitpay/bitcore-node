#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

var util = require('util');
var fs = require('fs');
var argv = require('optimist').argv;
var rimraf = require('rimraf');
var assert = require('assert');

/**
 * bitcoind
 */

if (fs.existsSync(process.env.HOME + '/.libbitcoind-example')) {
  rimraf.sync(process.env.HOME + '/.libbitcoind-example');
}

var bitcoind = require('../')({
  directory: '~/.libbitcoind-example'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);

  if (argv.list) {
    return;
  }

  if (argv.blocks) {
    return getBlocks(bitcoind);
  }

  function assertHex(obj) {
    // Hash
    if (obj.txid) {
      assert.equal(obj.hash, obj.getHash('hex'));
    } else {
      assert.equal(obj.hash, obj.getHash('hex'));
    }
    // Hex
    if (obj.txid) {
      assert.equal(obj.hex, obj.toHex());
    } else {
      assert.equal(obj.hex, obj.toHex());
    }
  }

  if (argv['on-block']) {
    return bitcoind.on('block', function callee(block) {
      if (block.tx.length === 1) return;
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return assertHex(block);
    });
  }

  if (argv['on-tx']) {
    bitcoind.on('tx', function(tx) {
      bitcoind.log('Found TX:');
      bitcoind.log(tx);
      return assertHex(tx);
    });
    bitcoind.on('mptx', function(mptx) {
      bitcoind.log('Found mempool TX:');
      bitcoind.log(mptx);
      return assertHex(mptx);
    });
    return;
  }

  if (argv.broadcast) {
    // Help propagate transactions
    return bitcoind.once('tx', function(tx) {
      bitcoind.log('Broadcasting TX...');
      return tx.broadcast(function(err, hash, tx) {
        if (err) throw err;
        bitcoind.log('TX Hash: %s', hash);
        return bitcoind.log(tx);
      });
    });
  }

  // Test fromHex:
  if (argv['from-hex']) {
    var block = bitcoind.block(testBlock);
    assert.equal(block.hash, '0000000000013b8ab2cd513b0261a14096412195a72a0c4827d229dcc7e0f7af');
    assert.equal(block.merkleroot, '2fda58e5959b0ee53c5253da9b9f3c0c739422ae04946966991cf55895287552');
    bitcoind.log('Block:');
    bitcoind.log(block);
    var tx = bitcoind.tx(testTx);
    assert.equal(tx.txid, 'b4749f017444b051c44dfd2720e88f314ff94f3dd6d56d40ef65854fcd7fff6b');
    bitcoind.log('Transaction:');
    bitcoind.log(tx);
    return;
  }

  // Test all digest packets:
  if (argv['packets']) {
    bitcoind.on('digest', function(packet) {
      return bitcoind.log(packet);
    });
    return;
  }

  argv['on-block'] = true;
  setTimeout(function() {
    bitcoind.on('block', function callee(block) {
      if (!argv['on-block']) {
        return bitcoind.removeListener('block', callee);
      }
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return assertHex(block);
    });

    bitcoind.once('block', function(block) {
      setTimeout(function() {
        argv['on-block'] = false;

        bitcoind.log(bitcoind.getInfo());
        bitcoind.log(bitcoind.getPeerInfo());

        bitcoind.once('version', function(version) {
          bitcoind.log('VERSION packet:');
          bitcoind.log(version);
        });

        bitcoind.once('addr', function(addr) {
          bitcoind.log('ADDR packet:');
          bitcoind.log(addr);
        });
      }, 8000);
    });
  }, 2000);

  return;
});

/**
 * Helpers
 */

function getBlocks(bitcoind) {
  return setTimeout(function() {
    return (function next(hash) {
      return bitcoind.getBlock(hash, function(err, block) {
        if (err) return bitcoind.log(err.message);

        bitcoind.log(block);

        if (argv['get-tx'] && block.tx.length && block.tx[0].txid) {
          var txid = block.tx[0].txid;
          // XXX Dies with a segfault
          // bitcoind.getTx(txid, hash, function(err, tx) {
          bitcoind.getTx(txid, function(err, tx) {
            if (err) return bitcoind.log(err.message);
            bitcoind.log('TX -----------------------------------------------------');
            bitcoind.log(tx);
            bitcoind.log('/TX ----------------------------------------------------');
          });
        }

        if (block.nextblockhash) {
          setTimeout(next.bind(null, block.nextblockhash), 500);
        }
      });
    })(genesisBlock);
  }, 1000);
}
