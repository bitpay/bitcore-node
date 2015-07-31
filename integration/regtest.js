'use strict';

// These tests require bitcoind.js Bitcoin Core bindings to be compiled with
// the environment variable BITCOINDJS_ENV=test. This enables the use of regtest
// functionality by including the wallet in the build.
// To run the tests: $ mocha -R spec integration/regtest.js

if (process.env.BITCOINDJS_ENV !== 'test') {
  console.log('Please set the environment variable BITCOINDJS_ENV=test and make sure bindings are compiled for testing');
  process.exit();
}

var chai = require('chai');
var bitcore = require('bitcore');
var BN = bitcore.crypto.BN;
var rimraf = require('rimraf');
var bitcoind;

/* jshint unused: false */
var should = chai.should();
var assert = chai.assert;
var sinon = require('sinon');
var BitcoinRPC = require('bitcoind-rpc');
var blockHashes = [];
var utxo;
var client;
var coinbasePrivateKey;
var privateKey = bitcore.PrivateKey();
var destKey = bitcore.PrivateKey();

describe('Daemon Binding Functionality', function() {

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

    rimraf(datadir + '/regtest', function(err) {

      if (err) {
        throw err;
      }

      bitcoind = require('../').daemon({
        datadir: datadir,
        network: 'regtest'
      });

      bitcoind.on('error', function(err) {
        bitcoind.log('error="%s"', err.message);
      });

      bitcoind.on('open', function(status) {
        bitcoind.log('status="%s"', status);
      });

      console.log('Waiting for Bitcoin Core to initialize...');

      bitcoind.on('ready', function() {

        client = new BitcoinRPC({
          protocol: 'http',
          host: '127.0.0.1',
          port: 18332,
          user: 'bitcoin',
          pass: 'local321'
        });

        console.log('Generating 100 blocks...');

        // Generate enough blocks so that the initial coinbase transactions
        // can be spent.

        client.generate(150, function(err, response) {
          if (err) {
            throw err;
          }
          blockHashes = response.result;

          // The original coinbase transactions when using regtest spend to
          // a non-standard pubkeyout instead of a pubkeyhashout.
          // We'll construct a new transaction that will send funds
          // to a new address with pubkeyhashout for later testing.

          console.log('Preparing unspent outputs...');

          client.getBalance(function(err, response) {
            if (err) {
              throw err;
            }

            var amount = response.result;
            var fee = 0.01;
            var network = bitcore.Networks.get('regtest');
            var address = privateKey.toAddress(network);

            client.sendToAddress(address, amount - fee, '', '', function(err, response) {
              if (err) {
                throw err;
              }

              var txid = response.result;
              client.getTransaction(txid, function(err, response) {
                if (err) {
                  throw err;
                }

                var unspentTransaction = bitcore.Transaction();
                var outputIndex;
                unspentTransaction.fromString(response.result.hex);
                for (var i = 0; i < unspentTransaction.outputs.length; i++) {
                  var output = unspentTransaction.outputs[i];
                  if (output.script.toAddress(network).toString() === address.toString(network)) {
                    outputIndex = i;
                  }
                }

                utxo = {
                  txid: unspentTransaction.hash,
                  outputIndex: outputIndex,
                  script: unspentTransaction.outputs[outputIndex].script,
                  satoshis: unspentTransaction.outputs[outputIndex].satoshis
                };

                // Include this transaction in a block so that it can
                // be spent in tests
                client.generate(1, function(err, response) {
                  if (err) {
                    throw err;
                  }

                  console.log('Testing setup complete!');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  after(function(done) {
    this.timeout(20000);
    bitcoind.stop(function(err, result) {
      done();
    });
  });

  describe('get blocks by hash', function() {

    [0,1,2,3,5,6,7,8,9].forEach(function(i) {
      it('generated block ' + i, function(done) {
        bitcoind.getBlock(blockHashes[i], function(err, response) {
          if (err) {
            throw err;
          }
          should.exist(response);
          var block = bitcore.Block.fromBuffer(response);
          block.hash.should.equal(blockHashes[i]);
          done();
        });
      });
    });
  });

  describe('get blocks by height', function() {

    [0,1,2,3,5,6,7,8,9].forEach(function(i) {
      it('generated block ' + i, function(done) {
        // add the genesis block
        var height = i + 1;
        bitcoind.getBlock(i + 1, function(err, response) {
          if (err) {
            throw err;
          }
          should.exist(response);
          var block = bitcore.Block.fromBuffer(response);
          block.hash.should.equal(blockHashes[i]);
          done();
        });
      });
    });
  });

  describe('get block index', function() {
    var expectedWork = new BN(6);
    [1,2,3,4,5,6,7,8,9].forEach(function(i) {
      it('generate block ' + i, function() {
        var blockIndex = bitcoind.getBlockIndex(blockHashes[i]);
        should.exist(blockIndex);
        should.exist(blockIndex.chainWork);
        var work = new BN(blockIndex.chainWork, 'hex');
        work.cmp(expectedWork).should.equal(0);
        expectedWork = expectedWork.add(new BN(2));
        should.exist(blockIndex.prevHash);
        blockIndex.prevHash.should.equal(blockHashes[i - 1]);
      });
    });
  });

  describe('send transaction functionality', function() {

    it('will not error and return the transaction hash', function() {

      // create and sign the transaction
      var tx = bitcore.Transaction();
      tx.from(utxo);
      tx.change(privateKey.toAddress());
      tx.to(destKey.toAddress(), 100000);
      tx.sign(privateKey);

      // test sending the transaction
      var hash = bitcoind.sendTransaction(tx.serialize());
      hash.should.equal(tx.hash);
    });

  });

  describe('fee estimation', function() {
    it('will estimate fees', function() {
      var fees = bitcoind.estimateFee();
      fees.should.equal(-1);
    });
  });

  describe('tip updates', function() {
    it('will get an event when the tip is new', function(done) {
      this.timeout(4000);
      bitcoind.on('tip', function(height) {
        height.should.equal(152);
        done();
      });
      client.generate(1, function(err, response) {
        if (err) {
          throw err;
        }
      });
    });
  });

  describe('mempool functionality', function() {

    var fromAddress = 'mszYqVnqKoQx4jcTdJXxwKAissE3Jbrrc1';
    var utxo1 = {
      address: fromAddress,
      txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
      outputIndex: 0,
      script: bitcore.Script.buildPublicKeyHashOut(fromAddress).toString(),
      satoshis: 100000
    };
    var toAddress = 'mrU9pEmAx26HcbKVrABvgL7AwA5fjNFoDc';
    var changeAddress = 'mgBCJAsvzgT2qNNeXsoECg2uPKrUsZ76up';
    var changeAddressP2SH = '2N7T3TAetJrSCruQ39aNrJvYLhG1LJosujf';
    var privateKey1 = 'cSBnVM4xvxarwGQuAfQFwqDg9k5tErHUHzgWsEfD4zdwUasvqRVY';
    var private1 = '6ce7e97e317d2af16c33db0b9270ec047a91bff3eff8558afb5014afb2bb5976';
    var private2 = 'c9b26b0f771a0d2dad88a44de90f05f416b3b385ff1d989343005546a0032890';
    var tx = new bitcore.Transaction();
    tx.from(utxo1);
    tx.to(toAddress, 50000);
    tx.change(changeAddress);
    tx.sign(privateKey1);

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

  describe('get transaction with block info', function() {
    it('should include tx buffer, height and timestamp', function(done) {
      bitcoind.getTransactionWithBlockInfo(utxo.txid, true, function(err, data) {
        should.not.exist(err);
        data.height.should.equal(151);
        should.exist(data.timestamp);
        should.exist(data.buffer);
        done();
      });
    });
  });

});
