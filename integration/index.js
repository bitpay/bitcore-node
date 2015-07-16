'use strict';

// These tests require a fully synced Bitcore Code data directory.
// To run the tests: $ mocha -R spec index.js

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
    bitcoind = require('../')({
      directory: process.env.BITCOINDJS_DIR || '~/.bitcoin',
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

});
