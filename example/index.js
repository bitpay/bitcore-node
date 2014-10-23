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

var genesisBlock = '0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
var genesisTx = '0x4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

var testTx = "01000000010b26e9b7735eb6aabdf358bab62f9816a21ba9ebdb719d5299e88607d722c190000000008b4830450220070aca44506c5cef3a16ed519d7c3c39f8aab192c4e1c90d065f37b8a4af6141022100a8e160b856c2d43d27d8fba71e5aef6405b8643ac4cb7cb3c462aced7f14711a0141046d11fee51b0e60666d5049a9101a72741df480b96ee26488a4d3466b95c9a40ac5eeef87e10a5cd336c19a84565f80fa6c547957b7700ff4dfbdefe76036c339ffffffff021bff3d11000000001976a91404943fdd508053c75000106d3bc6e2754dbcff1988ac2f15de00000000001976a914a266436d2965547608b9e15d9032a7b9d64fa43188ac00000000";

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);

  if (argv.list) {
    return bitcoind.log(bitcoind.wallet.listAccounts());
  }

  if (argv.blocks) {
    return getBlocks(bitcoind);
  }

  if (argv['test-tx']) {
    var tx = bitcoind.tx.fromHex(testTx);
    bitcoind.log(tx);
    bitcoind.log(tx.txid === tx.getHash('hex'));
    return;
  }

  function compareObj(obj) {
    // Hash
    if (obj.txid) {
      //bitcoind.log('tx.txid: %s', obj.txid);
      //bitcoind.log('tx.getHash("hex"): %s', obj.getHash('hex'));
      //bitcoind.log('tx.txid === tx.getHash("hex"): %s', obj.txid === obj.getHash('hex'));
      assert.equal(obj.hash, obj.getHash('hex'));
    } else {
      //bitcoind.log('block.hash: %s', obj.hash);
      //bitcoind.log('block.getHash("hex"): %s', obj.getHash('hex'));
      //bitcoind.log('block.hash === block.getHash("hex"): %s', obj.hash === obj.getHash('hex'));
      assert.equal(obj.hash, obj.getHash('hex'));
    }

    // Hex
    if (obj.txid) {
      //bitcoind.log('tx.hex: %s', obj.hex);
      //bitcoind.log('tx.toHex(): %s', obj.toHex());
      //bitcoind.log('tx.hex === tx.toHex(): %s', obj.hex === obj.toHex());
      assert.equal(obj.hex, obj.toHex());
    } else {
      //bitcoind.log('block.hex: %s', obj.hex);
      //bitcoind.log('block.toHex(): %s', obj.toHex());
      //bitcoind.log('block.hex === block.toHex(): %s', obj.hex === obj.toHex());
      assert.equal(obj.hex, obj.toHex());
    }
  }

  if (argv['on-block']) {
    return bitcoind.on('block', function callee(block) {
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return compareObj(block);
    });
  }

  if (argv['on-tx']) {
    bitcoind.on('tx', function(tx) {
      bitcoind.log('Found TX:');
      bitcoind.log(tx);
      return compareObj(tx);
    });
    bitcoind.on('mptx', function(mptx) {
      bitcoind.log('Found mempool TX:');
      bitcoind.log(mptx);
      return compareObj(mptx);
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

  bitcoind.on('packet:parsed', function(packet) {
    bitcoind.log(packet);
  });

  return;

  argv['on-block'] = true;
  setTimeout(function() {
    bitcoind.on('block', function callee(block) {
      if (!argv['on-block']) {
        return bitcoind.removeListener('block', callee);
      }
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return compareObj(block);
    });

    bitcoind.once('block', function(block) {
      setTimeout(function() {
        argv['on-block'] = false;

        bitcoind.log(bitcoind.getInfo());
        bitcoind.log(bitcoind.getPeerInfo());
        bitcoind.log(bitcoind.wallet.listAccounts());

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

  return bitcoind.log(bitcoind.wallet.listAccounts());
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
