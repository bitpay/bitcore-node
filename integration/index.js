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
var blockData = require('./livenet-block-data.json');
var testBlockData = require('./testnet-block-data.json');

describe('Basic Functionality', function() {

  before(function(done) {
    this.timeout(30000);
    bitcoind = require('../')({
      directory: '~/.bitcoin',
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

  describe('will get correct block data', function() {

    blockData.forEach(function(data) {
      var block = bitcore.Block.fromString(data);
      it('block ' + block.hash, function(done) {
        bitcoind.getBlock(block.hash, function(err, response) {
          assert(response === data, 'incorrect block data for ' + block.hash);
          done();
        });
      });
    });
  });

});
