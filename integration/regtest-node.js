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
var Transaction = index.Transaction;
var BitcoreNode = index.Node;
var AddressService = index.services.Address;
var BitcoinService = index.services.Bitcoin;
var DBService = index.services.DB;
var testWIF = 'cSdkPxkAjA4HDr5VHgsebAPDEh9Gyub4HK8UJr2DFGGqKKy4K5sG';
var testKey;
var client;

var outputForIsSpentTest1;

describe('Node Functionality', function() {

  var regtest;

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
    regtest = bitcore.Networks.get('regtest');

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

      node.start(function(err) {
        if (err) {
          throw err;
        }
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

  describe('Bus Functionality', function() {
    it('subscribes and unsubscribes to an event on the bus', function(done) {
      var bus = node.openBus();
      var block;
      bus.subscribe('db/block');
      bus.on('block', function(data) {
        bus.unsubscribe('db/block');
        data.should.be.equal(block);
        done();
      });
      client.generate(1, function(err, response) {
        if (err) {
          throw err;
        }
        block = response.result[0];
      });
    });
  });

  describe('Address Functionality', function() {
    var address;
    var unspentOutput;
    before(function() {
      address = testKey.toAddress().toString();
    });
    it('should be able to get the balance of the test address', function(done) {
      node.services.address.getBalance(address, false, function(err, balance) {
        if (err) {
          throw err;
        }
        balance.should.equal(10 * 1e8);
        done();
      });
    });
    it('can get unspent outputs for address', function(done) {
      node.services.address.getUnspentOutputs(address, false, function(err, results) {
        if (err) {
          throw err;
        }
        results.length.should.equal(1);
        unspentOutput = outputForIsSpentTest1 = results[0];
        done();
      });
    });
    it('correctly give the history for the address', function(done) {
      var options = {
        from: 0,
        to: 10,
        queryMempool: false
      };
      node.services.address.getAddressHistory(address, options, function(err, results) {
        if (err) {
          throw err;
        }
        var items = results.items;
        items.length.should.equal(1);
        var info = items[0];
        should.exist(info.addresses[address]);
        info.addresses[address].outputIndexes.length.should.equal(1);
        info.addresses[address].outputIndexes[0].should.be.within(0, 1);
        info.addresses[address].inputIndexes.should.deep.equal([]);
        info.satoshis.should.equal(10 * 1e8);
        info.confirmations.should.equal(3);
        info.timestamp.should.be.a('number');
        info.fees.should.be.within(190, 193);
        info.tx.should.be.an.instanceof(Transaction);
        done();
      });
    });
    it('correctly give the summary for the address', function(done) {
      var options = {
        queryMempool: false
      };
      node.services.address.getAddressSummary(address, options, function(err, results) {
        if (err) {
          throw err;
        }

        results.totalReceived.should.equal(1000000000);
        results.totalSpent.should.equal(0);
        results.balance.should.equal(1000000000);
        results.unconfirmedBalance.should.equal(1000000000);
        results.appearances.should.equal(1);
        results.unconfirmedAppearances.should.equal(0);
        results.txids.length.should.equal(1);
        done();
      });
    });
    describe('History', function() {

      this.timeout(20000);

      var testKey2;
      var address2;
      var testKey3;
      var address3;
      var testKey4;
      var address4;
      var testKey5;
      var address5;
      var testKey6;
      var address6;

      before(function(done) {
        /* jshint maxstatements: 50 */

        testKey2 = bitcore.PrivateKey.fromWIF('cNfF4jXiLHQnFRsxaJyr2YSGcmtNYvxQYSakNhuDGxpkSzAwn95x');
        address2 = testKey2.toAddress().toString();

        testKey3 = bitcore.PrivateKey.fromWIF('cVTYQbaFNetiZcvxzXcVMin89uMLC43pEBMy2etgZHbPPxH5obYt');
        address3 = testKey3.toAddress().toString();

        testKey4 = bitcore.PrivateKey.fromWIF('cPNQmfE31H2oCUFqaHpfSqjDibkt7XoT2vydLJLDHNTvcddCesGw');
        address4 = testKey4.toAddress().toString();

        testKey5 = bitcore.PrivateKey.fromWIF('cVrzm9gCmnzwEVMGeCxY6xLVPdG3XWW97kwkFH3H3v722nb99QBF');
        address5 = testKey5.toAddress().toString();

        testKey6 = bitcore.PrivateKey.fromWIF('cPfMesNR2gsQEK69a6xe7qE44CZEZavgMUak5hQ74XDgsRmmGBYF');
        address6 = testKey6.toAddress().toString();

        var tx = new Transaction();
        tx.from(unspentOutput);
        tx.to(address, 1 * 1e8);
        tx.to(address, 2 * 1e8);
        tx.to(address, 0.5 * 1e8);
        tx.to(address, 3 * 1e8);
        tx.fee(10000);
        tx.change(address);
        tx.sign(testKey);

        node.services.bitcoind.sendTransaction(tx.serialize());

        function mineBlock(next) {
          client.generate(1, function(err, response) {
            if (err) {
              throw err;
            }
            should.exist(response);
            next();
          });
        }

        client.generate(1, function(err, response) {
          if (err) {
            throw err;
          }
          should.exist(response);
          node.once('synced', function() {
            node.services.address.getUnspentOutputs(address, false, function(err, results) {
              /* jshint maxstatements: 50 */
              if (err) {
                throw err;
              }
              results.length.should.equal(5);

              async.series([
                function(next) {
                  var tx2 = new Transaction();
                  tx2.from(results[0]);
                  tx2.to(address2, results[0].satoshis - 10000);
                  tx2.change(address);
                  tx2.sign(testKey);
                  node.services.bitcoind.sendTransaction(tx2.serialize());
                  mineBlock(next);
                }, function(next) {
                  var tx3 = new Transaction();
                  tx3.from(results[1]);
                  tx3.to(address3, results[1].satoshis - 10000);
                  tx3.change(address);
                  tx3.sign(testKey);
                  node.services.bitcoind.sendTransaction(tx3.serialize());
                  mineBlock(next);
                }, function(next) {
                  var tx4 = new Transaction();
                  tx4.from(results[2]);
                  tx4.to(address4, results[2].satoshis - 10000);
                  tx4.change(address);
                  tx4.sign(testKey);
                  node.services.bitcoind.sendTransaction(tx4.serialize());
                  mineBlock(next);
                }, function(next) {
                  var tx5 = new Transaction();
                  tx5.from(results[3]);
                  tx5.from(results[4]);
                  tx5.to(address5, results[3].satoshis - 10000);
                  tx5.to(address6, results[4].satoshis - 10000);
                  tx5.change(address);
                  tx5.sign(testKey);
                  node.services.bitcoind.sendTransaction(tx5.serialize());
                  mineBlock(next);
                }
              ], function(err) {
                if (err) {
                  throw err;
                }
                node.once('synced', function() {
                  done();
                });
              });
            });
          });
        });

      });

      it('five addresses', function(done) {
        var addresses = [
          address2,
          address3,
          address4,
          address5,
          address6
        ];
        var options = {};
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(4);
          var history = results.items;
          history.length.should.equal(4);
          history[0].height.should.equal(157);
          history[0].confirmations.should.equal(1);
          history[1].height.should.equal(156);
          should.exist(history[1].addresses[address4]);
          history[2].height.should.equal(155);
          should.exist(history[2].addresses[address3]);
          history[3].height.should.equal(154);
          should.exist(history[3].addresses[address2]);
          history[3].satoshis.should.equal(99990000);
          history[3].confirmations.should.equal(4);
          done();
        });
      });

      it('five addresses (limited by height)', function(done) {
        var addresses = [
          address2,
          address3,
          address4,
          address5,
          address6
        ];
        var options = {
          start: 157,
          end: 156
        };
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(2);
          var history = results.items;
          history.length.should.equal(2);
          history[0].height.should.equal(157);
          history[0].confirmations.should.equal(1);
          history[1].height.should.equal(156);
          should.exist(history[1].addresses[address4]);
          done();
        });
      });

      it('five addresses (limited by height 155 to 154)', function(done) {
        var addresses = [
          address2,
          address3,
          address4,
          address5,
          address6
        ];
        var options = {
          start: 155,
          end: 154
        };
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(2);
          var history = results.items;
          history.length.should.equal(2);
          history[0].height.should.equal(155);
          history[1].height.should.equal(154);
          done();
        });
      });

      it('five addresses (paginated by index)', function(done) {
        var addresses = [
          address2,
          address3,
          address4,
          address5,
          address6
        ];
        var options = {
          from: 0,
          to: 3
        };
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(4);
          var history = results.items;
          history.length.should.equal(3);
          history[0].height.should.equal(157);
          history[0].confirmations.should.equal(1);
          history[1].height.should.equal(156);
          should.exist(history[1].addresses[address4]);
          done();
        });
      });

      it('one address with sending and receiving', function(done) {
        var addresses = [
          address
        ];
        var options = {};
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(6);
          var history = results.items;
          history.length.should.equal(6);
          history[0].height.should.equal(157);
          history[0].addresses[address].inputIndexes.should.deep.equal([0, 1]);
          history[0].addresses[address].outputIndexes.should.deep.equal([2]);
          history[0].confirmations.should.equal(1);
          history[1].height.should.equal(156);
          history[2].height.should.equal(155);
          history[3].height.should.equal(154);
          history[4].height.should.equal(153);
          history[4].satoshis.should.equal(-10000);
          history[4].addresses[address].outputIndexes.should.deep.equal([0, 1, 2, 3, 4]);
          history[4].addresses[address].inputIndexes.should.deep.equal([0]);
          history[5].height.should.equal(150);
          history[5].satoshis.should.equal(10 * 1e8);
          done();
        });
      });

      it('summary for an address (sending and receiving)', function(done) {
        node.services.address.getAddressSummary(address, {}, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalReceived.should.equal(2000000000);
          results.totalSpent.should.equal(1999990000);
          results.balance.should.equal(10000);
          results.unconfirmedBalance.should.equal(10000);
          results.appearances.should.equal(6);
          results.unconfirmedAppearances.should.equal(0);
          results.txids.length.should.equal(6);
          done();
        });
      });


      it('total transaction count (sending and receiving)', function(done) {
        var addresses = [
          address
        ];
        var options = {};
        node.services.address.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(6);
          done();
        });
      });

      describe('Pagination', function() {
        it('from 0 to 1', function(done) {
          var options = {
            from: 0,
            to: 1
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(157);
            done();
          });
        });
        it('from 1 to 2', function(done) {
          var options = {
            from: 1,
            to: 2
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(156);
            done();
          });
        });
        it('from 2 to 3', function(done) {
          var options = {
            from: 2,
            to: 3
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(155);
            done();
          });
        });
        it('from 3 to 4', function(done) {
          var options = {
            from: 3,
            to: 4
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(154);
            done();
          });
        });
        it('from 4 to 5', function(done) {
          var options = {
            from: 4,
            to: 5
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(153);
            history[0].satoshis.should.equal(-10000);
            history[0].addresses[address].outputIndexes.should.deep.equal([0, 1, 2, 3, 4]);
            history[0].addresses[address].inputIndexes.should.deep.equal([0]);
            done();
          });
        });
        it('from 5 to 6', function(done) {
          var options = {
            from: 5,
            to: 6
          };
          node.services.address.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].height.should.equal(150);
            history[0].satoshis.should.equal(10 * 1e8);
            done();
          });
        });

      });
    });

    describe('Mempool Index', function() {
      var unspentOutput;
      before(function(done) {
        node.services.address.getUnspentOutputs(address, false, function(err, results) {
          if (err) {
            throw err;
          }
          results.length.should.equal(1);
          unspentOutput = results[0];
          done();
        });
      });

      it('will update the mempool index after new tx', function(done) {

        var tx = new Transaction();
        tx.from(unspentOutput);
        tx.to(address, unspentOutput.satoshis - 1000);
        tx.fee(1000);
        tx.sign(testKey);

        node.services.bitcoind.sendTransaction(tx.serialize());

        setImmediate(function() {
          var length = node.services.address.mempoolOutputIndex[address].length;
          length.should.equal(1);
          should.exist(node.services.address.mempoolOutputIndex[address]);
          done();
        });

      });

    });

    describe('isSpent', function() {
      it('will return true if an input is spent in a confirmed transaction', function(done) {
        var result = node.services.bitcoind.isSpent(outputForIsSpentTest1.txid, outputForIsSpentTest1.outputIndex);
        result.should.equal(true);
        done();
      });
      //CCoinsViewMemPool only checks for spent outputs that are not the mempool
      it('will correctly return false for an input that is spent in an unconfirmed transaction', function(done) {
        node.services.address.getUnspentOutputs(address, false, function(err, results) {
          if (err) {
            throw err;
          }

          var unspentOutput = results[0];

          var tx = new Transaction();
          tx.from(unspentOutput);
          tx.to(address, unspentOutput.satoshis - 1000);
          tx.fee(1000);
          tx.sign(testKey);

          node.services.bitcoind.sendTransaction(tx.serialize());

          setImmediate(function() {
            var result = node.services.bitcoind.isSpent(unspentOutput.txid, unspentOutput.outputIndex);
            result.should.equal(false);
            done();
          });
        });
      });
    });
  });
});
