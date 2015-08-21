'use strict';

// These tests require bitcoind.js Bitcoin Core bindings to be compiled with
// the environment variable BITCOINDJS_ENV=test. This enables the use of regtest
// functionality by including the wallet in the build.
// To run the tests: $ mocha -R spec integration/regtest.js

var chainlib = require('chainlib');
var log = chainlib.log;

if (process.env.BITCORENODE_ENV !== 'test') {
  log.info('Please set the environment variable BITCORENODE_ENV=test and make sure bindings are compiled for testing');
  process.exit();
}

var chai = require('chai');
var bitcore = require('bitcore');
var rimraf = require('rimraf');
var node;

var should = chai.should();

var BitcoinRPC = require('bitcoind-rpc');
var BitcoreNode = require('..').Node;
var testWIF = 'cSdkPxkAjA4HDr5VHgsebAPDEh9Gyub4HK8UJr2DFGGqKKy4K5sG';
var testKey;
var client;

describe('Node Functionality', function() {

  before(function(done) {
    this.timeout(30000);

    // Add the regtest network
    bitcore.Networks.remove(bitcore.Networks.testnet);
    bitcore.Networks.add({
      name: 'regtest',
      alias: 'regtest',
      pubkeyhash: 0x6f,
      privatekey: 0xef,
      scripthash: 0xc4,
      xpubkey: 0x043587cf,
      xprivkey: 0x04358394,
      networkMagic: 0xfabfb5da,
      port: 18444,
      dnsSeeds: [ ]
    });

    var datadir = __dirname + '/data';

    testKey = bitcore.PrivateKey(testWIF);

    rimraf(datadir + '/regtest', function(err) {

      if (err) {
        throw err;
      }

      var configuration = {
        datadir: datadir,
        network: 'regtest'
      };

      node = new BitcoreNode(configuration);

      node.on('error', function(err) {
        log.error(err);
      });

      node.on('ready', function() {

        client = new BitcoinRPC({
          protocol: 'http',
          host: '127.0.0.1',
          port: 18332,
          user: 'bitcoin',
          pass: 'local321'
        });

        node.on('synced', function() {
          //todo: refactor to remove the event listener
          if (node.chain.tip.__height === 150) {
            done();
          }
        });

        client.generate(150, function(err, response) {
          if (err) {
            throw err;
          }
        });
      });


    });
  });

  after(function(done) {
    this.timeout(20000);
    node.db.bitcoind.stop(function(err, result) {
      done();
    });
  });

  describe('bitcoin core daemon reorgs', function() {

    before(function(done) {
      client.getBlockCount(function(err, response) {
        if (err) {
          throw err;
        }
        var count = response.result;
        client.getBlockHash(count, function(err, response) {
          if (err) {
            throw err;
          }
          var blockHash = response.result;
          client.invalidateBlock(blockHash, function(err, response) {
            if (err) {
               throw err;
            }
            client.getBlockCount(function(err, response) {
              if (err) {
                throw err;
              }
              response.result.should.equal(count - 1);
              done();
            });
          });
        });
      });
    });

    it('will handle a reorganization', function(done) {

      node.db.bitcoind.on('tip', function(height) {
        height.should.equal(151);
        done();
      });

      // We need to add a transaction to the mempool so that the next block will
      // have a different hash as the hash has been invalidated.
      client.sendToAddress(testKey.toAddress().toString(), 10, function(err) {
        if (err) {
          throw err;
        }
        client.generate(2, function(err, response) {
          if (err) {
            throw err;
          }
        });
      });

    });
  });

});
