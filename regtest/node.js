'use strict';

// To run the tests: $ mocha -R spec regtest/node.js

var path = require('path');
var index = require('..');
var async = require('async');
var log = index.log;
log.debug = function() {};

var chai = require('chai');
var bitcore = require('bitcore-lib');
var rimraf = require('rimraf');
var node;

var should = chai.should();

var BitcoinRPC = require('bitcoind-rpc');
var index = require('..');
var Transaction = bitcore.Transaction;
var BitcoreNode = index.Node;
var BitcoinService = index.services.Bitcoin;
var testWIF = 'cSdkPxkAjA4HDr5VHgsebAPDEh9Gyub4HK8UJr2DFGGqKKy4K5sG';
var testKey;
var client;

var outputForIsSpentTest1;
var unspentOutputSpentTxId;

describe('Node Functionality', function() {

  var regtest;

  before(function(done) {
    this.timeout(20000);

    var datadir = __dirname + '/data';

    testKey = bitcore.PrivateKey(testWIF);

    rimraf(datadir + '/regtest', function(err) {

      if (err) {
        throw err;
      }

      var configuration = {
        network: 'regtest',
        services: [
          {
            name: 'bitcoind',
            module: BitcoinService,
            config: {
              spawn: {
                datadir: datadir,
                exec: path.resolve(__dirname, '../bin/bitcoind')
              }
            }
          }
        ]
      };

      node = new BitcoreNode(configuration);

      regtest = bitcore.Networks.get('regtest');
      should.exist(regtest);

      node.on('error', function(err) {
        log.error(err);
      });

      node.start(function(err) {
        if (err) {
          return done(err);
        }

        client = new BitcoinRPC({
          protocol: 'http',
          host: '127.0.0.1',
          port: 30331,
          user: 'bitcoin',
          pass: 'local321',
          rejectUnauthorized: false
        });

        var syncedHandler = function() {
          if (node.services.bitcoind.height === 150) {
            node.services.bitcoind.removeListener('synced', syncedHandler);
            done();
          }
        };

        node.services.bitcoind.on('synced', syncedHandler);

        client.generate(150, function(err) {
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

  describe('Bus Functionality', function() {
    it('subscribes and unsubscribes to an event on the bus', function(done) {
      var bus = node.openBus();
      var blockExpected;
      var blockReceived;
      bus.subscribe('bitcoind/hashblock');
      bus.on('bitcoind/hashblock', function(data) {
        bus.unsubscribe('bitcoind/hashblock');
        if (blockExpected) {
          data.should.be.equal(blockExpected);
          done();
        } else {
          blockReceived = data;
        }
      });
      client.generate(1, function(err, response) {
        if (err) {
          throw err;
        }
        if (blockReceived) {
          blockReceived.should.be.equal(response.result[0]);
          done();
        } else {
          blockExpected = response.result[0];
        }
      });
    });
  });

  describe('Address Functionality', function() {
    var address;
    var unspentOutput;
    before(function(done) {
      this.timeout(10000);
      address = testKey.toAddress(regtest).toString();
      var startHeight = node.services.bitcoind.height;
      node.services.bitcoind.on('tip', function(height) {
        if (height === startHeight + 3) {
          done();
        }
      });
      client.sendToAddress(testKey.toAddress(regtest).toString(), 10, function(err) {
        if (err) {
          throw err;
        }
        client.generate(3, function(err) {
          if (err) {
            throw err;
          }
        });
      });
    });
    it('should be able to get the balance of the test address', function(done) {
      node.getAddressBalance(address, false, function(err, data) {
        if (err) {
          throw err;
        }
        data.balance.should.equal(10 * 1e8);
        done();
      });
    });
    it('can get unspent outputs for address', function(done) {
      node.getAddressUnspentOutputs(address, false, function(err, results) {
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
      node.getAddressHistory(address, options, function(err, results) {
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
        info.tx.blockTimestamp.should.be.a('number');
        info.tx.feeSatoshis.should.be.within(950, 4000);
        done();
      });
    });
    it('correctly give the summary for the address', function(done) {
      var options = {
        queryMempool: false
      };
      node.getAddressSummary(address, options, function(err, results) {
        if (err) {
          throw err;
        }
        results.totalReceived.should.equal(1000000000);
        results.totalSpent.should.equal(0);
        results.balance.should.equal(1000000000);
        should.not.exist(results.unconfirmedBalance);
        results.appearances.should.equal(1);
        should.not.exist(results.unconfirmedAppearances);
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
      var tx2Amount;
      var tx2Hash;

      before(function(done) {
        /* jshint maxstatements: 50 */

        // Finished once all blocks have been mined
        var startHeight = node.services.bitcoind.height;
        node.services.bitcoind.on('tip', function(height) {
          if (height === startHeight + 5) {
            done();
          }
        });

        testKey2 = bitcore.PrivateKey.fromWIF('cNfF4jXiLHQnFRsxaJyr2YSGcmtNYvxQYSakNhuDGxpkSzAwn95x');
        address2 = testKey2.toAddress(regtest).toString();

        testKey3 = bitcore.PrivateKey.fromWIF('cVTYQbaFNetiZcvxzXcVMin89uMLC43pEBMy2etgZHbPPxH5obYt');
        address3 = testKey3.toAddress(regtest).toString();

        testKey4 = bitcore.PrivateKey.fromWIF('cPNQmfE31H2oCUFqaHpfSqjDibkt7XoT2vydLJLDHNTvcddCesGw');
        address4 = testKey4.toAddress(regtest).toString();

        testKey5 = bitcore.PrivateKey.fromWIF('cVrzm9gCmnzwEVMGeCxY6xLVPdG3XWW97kwkFH3H3v722nb99QBF');
        address5 = testKey5.toAddress(regtest).toString();

        testKey6 = bitcore.PrivateKey.fromWIF('cPfMesNR2gsQEK69a6xe7qE44CZEZavgMUak5hQ74XDgsRmmGBYF');
        address6 = testKey6.toAddress(regtest).toString();

        var tx = new Transaction();
        tx.from(unspentOutput);
        tx.to(address, 1 * 1e8);
        tx.to(address, 2 * 1e8);
        tx.to(address, 0.5 * 1e8);
        tx.to(address, 3 * 1e8);
        tx.fee(10000);
        tx.change(address);
        tx.sign(testKey);

        unspentOutputSpentTxId = tx.id;

        function mineBlock(next) {
          client.generate(1, function(err, response) {
            if (err) {
              throw err;
            }
            should.exist(response);
            next();
          });
        }

        node.sendTransaction(tx.serialize(), function(err, hash) {
          if (err) {
            return done(err);
          }

          client.generate(1, function(err, response) {
            if (err) {
              throw err;
            }
            should.exist(response);

            node.getAddressUnspentOutputs(address, false, function(err, results) {
              /* jshint maxstatements: 50 */
              if (err) {
                throw err;
              }
              results.length.should.equal(5);

              async.series([
                function(next) {
                  var tx2 = new Transaction();
                  tx2Amount = results[0].satoshis - 10000;
                  tx2.from(results[0]);
                  tx2.to(address2, tx2Amount);
                  tx2.change(address);
                  tx2.sign(testKey);
                  tx2Hash = tx2.hash;
                  node.sendTransaction(tx2.serialize(), function(err) {
                    if (err) {
                      return next(err);
                    }
                    mineBlock(next);
                  });
                }, function(next) {
                  var tx3 = new Transaction();
                  tx3.from(results[1]);
                  tx3.to(address3, results[1].satoshis - 10000);
                  tx3.change(address);
                  tx3.sign(testKey);
                  node.sendTransaction(tx3.serialize(), function(err) {
                    if (err) {
                      return next(err);
                    }
                    mineBlock(next);
                  });
                }, function(next) {
                  var tx4 = new Transaction();
                  tx4.from(results[2]);
                  tx4.to(address4, results[2].satoshis - 10000);
                  tx4.change(address);
                  tx4.sign(testKey);
                  node.sendTransaction(tx4.serialize(), function(err) {
                    if (err) {
                      return next(err);
                    }
                    mineBlock(next);
                  });
                }, function(next) {
                  var tx5 = new Transaction();
                  tx5.from(results[3]);
                  tx5.from(results[4]);
                  tx5.to(address5, results[3].satoshis - 10000);
                  tx5.to(address6, results[4].satoshis - 10000);
                  tx5.change(address);
                  tx5.sign(testKey);
                  node.sendTransaction(tx5.serialize(), function(err) {
                    if (err) {
                      return next(err);
                    }
                    mineBlock(next);
                  });
                }
              ], function(err) {
                if (err) {
                  throw err;
                }
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
        node.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(4);
          var history = results.items;
          history.length.should.equal(4);
          history[0].tx.height.should.equal(159);
          history[0].confirmations.should.equal(1);
          history[1].tx.height.should.equal(158);
          should.exist(history[1].addresses[address4]);
          history[2].tx.height.should.equal(157);
          should.exist(history[2].addresses[address3]);
          history[3].tx.height.should.equal(156);
          should.exist(history[3].addresses[address2]);
          history[3].satoshis.should.equal(tx2Amount);
          history[3].tx.hash.should.equal(tx2Hash);
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
          start: 158,
          end: 157
        };
        node.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(2);
          var history = results.items;
          history.length.should.equal(2);
          history[0].tx.height.should.equal(158);
          history[0].confirmations.should.equal(2);
          history[1].tx.height.should.equal(157);
          should.exist(history[1].addresses[address3]);
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
          start: 157,
          end: 156
        };
        node.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(2);
          var history = results.items;
          history.length.should.equal(2);
          history[0].tx.height.should.equal(157);
          history[1].tx.height.should.equal(156);
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
        node.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(4);
          var history = results.items;
          history.length.should.equal(3);
          history[0].tx.height.should.equal(159);
          history[0].confirmations.should.equal(1);
          history[1].tx.height.should.equal(158);
          should.exist(history[1].addresses[address4]);
          done();
        });
      });

      it('one address with sending and receiving', function(done) {
        var addresses = [
          address
        ];
        var options = {};
        node.getAddressHistory(addresses, options, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalCount.should.equal(6);
          var history = results.items;
          history.length.should.equal(6);
          history[0].tx.height.should.equal(159);
          history[0].addresses[address].inputIndexes.should.deep.equal([0, 1]);
          history[0].addresses[address].outputIndexes.should.deep.equal([2]);
          history[0].confirmations.should.equal(1);
          history[1].tx.height.should.equal(158);
          history[2].tx.height.should.equal(157);
          history[3].tx.height.should.equal(156);
          history[4].tx.height.should.equal(155);
          history[4].satoshis.should.equal(-10000);
          history[4].addresses[address].outputIndexes.should.deep.equal([0, 1, 2, 3, 4]);
          history[4].addresses[address].inputIndexes.should.deep.equal([0]);
          history[5].tx.height.should.equal(152);
          history[5].satoshis.should.equal(10 * 1e8);
          done();
        });
      });

      it('summary for an address (sending and receiving)', function(done) {
        node.getAddressSummary(address, {}, function(err, results) {
          if (err) {
            throw err;
          }
          results.totalReceived.should.equal(2000000000);
          results.totalSpent.should.equal(1999990000);
          results.balance.should.equal(10000);
          results.unconfirmedBalance.should.equal(0);
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
        node.getAddressHistory(addresses, options, function(err, results) {
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
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(159);
            done();
          });
        });
        it('from 1 to 2', function(done) {
          var options = {
            from: 1,
            to: 2
          };
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(158);
            done();
          });
        });
        it('from 2 to 3', function(done) {
          var options = {
            from: 2,
            to: 3
          };
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(157);
            done();
          });
        });
        it('from 3 to 4', function(done) {
          var options = {
            from: 3,
            to: 4
          };
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(156);
            done();
          });
        });
        it('from 4 to 5', function(done) {
          var options = {
            from: 4,
            to: 5
          };
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(155);
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
          node.getAddressHistory(address, options, function(err, results) {
            if (err) {
              throw err;
            }
            var history = results.items;
            history.length.should.equal(1);
            history[0].tx.height.should.equal(152);
            history[0].satoshis.should.equal(10 * 1e8);
            done();
          });
        });

      });
    });

    describe('Mempool Index', function() {
      var unspentOutput;
      before(function(done) {
        node.getAddressUnspentOutputs(address, false, function(err, results) {
          if (err) {
            throw err;
          }
          results.length.should.equal(1);
          unspentOutput = results[0];
          done();
        });
      });

      it('will update the mempool index after new tx', function(done) {
        var memAddress = bitcore.PrivateKey().toAddress(node.network).toString();
        var tx = new Transaction();
        tx.from(unspentOutput);
        tx.to(memAddress, unspentOutput.satoshis - 1000);
        tx.fee(1000);
        tx.sign(testKey);

        node.services.bitcoind.sendTransaction(tx.serialize(), function(err, hash) {
          node.getAddressTxids(memAddress, {}, function(err, txids) {
            if (err) {
              return done(err);
            }
            txids.length.should.equal(1);
            txids[0].should.equal(hash);
            done();
          });
        });
      });

    });

  });

  describe('Orphaned Transactions', function() {
    this.timeout(8000);
    var orphanedTransaction;

    before(function(done) {
      var count;
      var invalidatedBlockHash;

      async.series([
        function(next) {
          client.sendToAddress(testKey.toAddress(regtest).toString(), 10, function(err) {
            if (err) {
              return next(err);
            }
            client.generate(1, next);
          });
        },
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
          client.getBlock(invalidatedBlockHash, function(err, response) {
            if (err) {
              return next(err);
            }
            orphanedTransaction = response.result.tx[1];
            should.exist(orphanedTransaction);
            next();
          });
        },
        function(next) {
          client.invalidateBlock(invalidatedBlockHash, next);
        }
      ], function(err) {
        if (err) {
          throw err;
        }
        done();
      });
    });

    it('will not show confirmation count for orphaned transaction', function(done) {
      // This test verifies that in the situation that the transaction is not in the mempool and
      // is included in an orphaned block transaction index that the confirmation count will be unconfirmed.
      node.getDetailedTransaction(orphanedTransaction, function(err, data) {
        if (err) {
          return done(err);
        }
        should.exist(data);
        should.exist(data.height);
        data.height.should.equal(-1);
        done();
      });
    });

  });

});
