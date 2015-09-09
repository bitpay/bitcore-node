'use strict';

// These tests require bitcore-node Bitcoin Core bindings to be compiled with
// the environment variable BITCORENODE_ENV=test. This enables the use of regtest
// functionality by including the wallet in the build.
// To run the tests: $ mocha -R spec integration/regtest-node.js

var index = require('..');
var async = require('async');
var log = index.log;
log.debug = function() {};

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
var index = require('..');
var BitcoreNode = index.Node;
var AddressService = index.services.Address;
var BitcoinService = index.services.Bitcoin;
var DBService = index.services.DB;
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
        network: 'regtest',
        services: [
          {
            name: 'db',
            module: DBService,
            config: {}
          },
          {
            name: 'bitcoind',
            module: BitcoinService,
            config: {}
          },
          {
            name: 'address',
            module: AddressService,
            config: {}
          }
        ]
      };

      node = new BitcoreNode(configuration);

      node.on('error', function(err) {
        log.error(err);
      });

      node.on('ready', function() {

        client = new BitcoinRPC({
          protocol: 'https',
          host: '127.0.0.1',
          port: 18332,
          user: 'bitcoin',
          pass: 'local321',
          rejectUnauthorized: false
        });

        var syncedHandler = function() {
          if (node.services.db.tip.__height === 150) {
            node.removeListener('synced', syncedHandler);
            done();
          }
        };

        node.on('synced', syncedHandler);

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
    node.stop(function(err, result) {
      if(err) {
        throw err;
      }
      done();
    });
  });

  var invalidatedBlockHash;

  it('will handle a reorganization', function(done) {

    var count;
    var blockHash;

    async.series([
      function(next) {
        client.getBlockCount(function(err, response) {
          if (err) {
            return next(err);
          }
          count = response.result;
          next();
        });
      },
      function(next) {
        client.getBlockHash(count, function(err, response) {
          if (err) {
            return next(err);
          }
          invalidatedBlockHash = response.result;
          next();
        });
      },
      function(next) {
        client.invalidateBlock(invalidatedBlockHash, next);
      },
      function(next) {
        client.getBlockCount(function(err, response) {
          if (err) {
            return next(err);
          }
          response.result.should.equal(count - 1);
          next();
        });
      }
    ], function(err) {
      if (err) {
        throw err;
      }
      var blocksRemoved = 0;
      var blocksAdded = 0;

      var removeBlock = function() {
        blocksRemoved++;
      };

      node.services.db.on('removeblock', removeBlock);

      var addBlock = function() {
        blocksAdded++;
        if (blocksAdded === 2 && blocksRemoved === 1) {
          node.services.db.removeListener('addblock', addBlock);
          node.services.db.removeListener('removeblock', removeBlock);
          done();
        }
      };

      node.services.db.on('addblock', addBlock);

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

  it('isMainChain() will return false for stale/orphan block', function(done) {
    node.services.bitcoind.isMainChain(invalidatedBlockHash).should.equal(false);
    setImmediate(done);
  });
});
