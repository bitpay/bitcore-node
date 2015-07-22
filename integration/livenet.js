'use strict';

// These tests require a fully synced Bitcore Code data directory.
// To run the tests: $ mocha -R spec livenet.js

var chai = require('chai');
var bitcore = require('bitcore');
var bitcoind;

/* jshint unused: false */
var should = chai.should();
var assert = chai.assert;
var sinon = require('sinon');
var txData = require('./livenet-tx-data.json');
var blockData = require('./livenet-block-data.json');
var testTxData = require('./livenet-tx-data.json');
var spentData = require('./livenet-spents.json').spent;
var unspentData = require('./livenet-spents.json').unspent;
var testBlockData = require('./testnet-block-data.json');

describe('Basic Functionality', function() {

  before(function(done) {
    this.timeout(30000);
    bitcoind = require('../').daemon({
      datadir: process.env.BITCOINDJS_DIR || '~/.bitcoin',
    });

    bitcoind.on('error', function(err) {
      bitcoind.log('error="%s"', err.message);
    });

    bitcoind.on('open', function(status) {
      bitcoind.log('status="%s"', status);
    });

    console.log('Waiting for Bitcoin Core to initialize...');

    bitcoind.on('ready', function() {
      done();
    });

  });

  after(function(done) {
    this.timeout(20000);
    bitcoind.stop(function(err, result) {
      done();
    });
  });

  describe('get transactions by hash', function() {
    txData.forEach(function(data) {
      var tx = bitcore.Transaction();
      tx.fromString(data);
      it('for tx ' + tx.hash, function(done) {
        bitcoind.getTransaction(tx.hash, true, function(err, response) {
          if (err) {
            throw err;
          }
          assert(response.toString('hex') === data, 'incorrect tx data for ' + tx.hash);
          done();
        });
      });
    });
  });

  describe('determine if outpoint is unspent/spent', function() {
    spentData.forEach(function(data) {
      it('for spent txid ' + data.txid + ' and output ' + data.outputIndex, function() {
        var spent = bitcoind.isSpent(data.txid, data.outputIndex, true);
        spent.should.equal(true);
      });
    });

    unspentData.forEach(function(data) {
      it('for unspent txid ' + data.txid + ' and output ' + data.outputIndex, function() {
        var spent = bitcoind.isSpent(data.txid, data.outputIndex, true);
        spent.should.equal(false);
      });
    });
  });

  describe('get blocks by hash', function() {

    blockData.forEach(function(data) {
      var block = bitcore.Block.fromString(data);
      it('block ' + block.hash, function(done) {
        bitcoind.getBlock(block.hash, function(err, response) {
          assert(response.toString('hex') === data, 'incorrect block data for ' + block.hash);
          done();
        });
      });
    });
  });

  describe('get blocks by height', function() {

    var knownHeights = [
      [0, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'],
      [1, '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048'],
      [100000,'000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506'],
      [314159, '00000000000000001bb82a7f5973618cfd3185ba1ded04dd852a653f92a27c45']
    ];

    knownHeights.forEach(function(data) {
      it('block at height ' + data[0], function(done) {
        bitcoind.getBlock(data[0], function(err, response) {
          if (err) {
            throw err;
          }
          var block = bitcore.Block.fromBuffer(response);
          block.hash.should.equal(data[1]);
          done();
        });
      });
    });
  });

  describe('get chain work', function() {
    it('will get the total work for the genesis block via hash', function() {
      var hash = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
      var work = bitcoind.getChainWork(hash);
      work.should.equal('0000000000000000000000000000000000000000000000000000000100010001');
    });
    it('will get the total work for block #300000 via hash', function() {
      var hash = '000000000000000082ccf8f1557c5d40b21edabb18d2d691cfbf87118bac7254';
      var work = bitcoind.getChainWork(hash);
      work.should.equal('000000000000000000000000000000000000000000005a7b3c42ea8b844374e9');
    });
    it('will return undefined for unknown block', function() {
      var hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      var work = bitcoind.getChainWork(hash);
      should.equal(work, undefined);
    });
  });

  describe('mempool functionality', function() {

    var fromAddress = 'mszYqVnqKoQx4jcTdJXxwKAissE3Jbrrc1';
    var utxo = {
      address: fromAddress,
      txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
      outputIndex: 0,
      script: bitcore.Script.buildPublicKeyHashOut(fromAddress).toString(),
      satoshis: 100000
    };
    var toAddress = 'mrU9pEmAx26HcbKVrABvgL7AwA5fjNFoDc';
    var changeAddress = 'mgBCJAsvzgT2qNNeXsoECg2uPKrUsZ76up';
    var changeAddressP2SH = '2N7T3TAetJrSCruQ39aNrJvYLhG1LJosujf';
    var privateKey = 'cSBnVM4xvxarwGQuAfQFwqDg9k5tErHUHzgWsEfD4zdwUasvqRVY';
    var private1 = '6ce7e97e317d2af16c33db0b9270ec047a91bff3eff8558afb5014afb2bb5976';
    var private2 = 'c9b26b0f771a0d2dad88a44de90f05f416b3b385ff1d989343005546a0032890';
    var tx = new bitcore.Transaction();
    tx.from(utxo);
    tx.to(toAddress, 50000);
    tx.change(changeAddress);
    tx.sign(privateKey);

    it('will add an unchecked transaction', function() {
      var added = bitcoind.addMempoolUncheckedTransaction(tx.serialize());
      added.should.equal(true);
      bitcoind.getTransaction(tx.hash, true, function(err, txBuffer) {
        if(err) {
          throw err;
        }
        var expected = tx.toBuffer().toString('hex');
        txBuffer.toString('hex').should.equal(expected);
      });
    });

    it('get outputs by address', function() {
      var outputs = bitcoind.getMempoolOutputs(changeAddress);
      var expected = [
        {
          script: 'OP_DUP OP_HASH160 073b7eae2823efa349e3b9155b8a735526463a0f OP_EQUALVERIFY OP_CHECKSIG',
          satoshis: 40000,
          txid: tx.hash,
          outputIndex: 1
        }
      ];
      outputs.should.deep.equal(expected);
    });

  });

});

