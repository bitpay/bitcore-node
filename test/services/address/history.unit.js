'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var Transaction = require('../../../lib/transaction');
var AddressHistory = require('../../../lib/services/address/history');

describe('Address Service History', function() {

  var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';

  describe('@constructor', function() {
    it('will construct a new instance', function() {
      var node = {};
      var options = {};
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history.should.be.instanceof(AddressHistory);
      history.node.should.equal(node);
      history.options.should.equal(options);
      history.addresses.should.equal(addresses);
      history.transactionInfo.should.deep.equal([]);
      history.combinedArray.should.deep.equal([]);
      history.detailedArray.should.deep.equal([]);
    });
    it('will set addresses an array if only sent a string', function() {
      var history = new AddressHistory({
        node: {},
        options: {},
        addresses: address
      });
      history.addresses.should.deep.equal([address]);
    });
  });

  describe('#get', function() {
    it('will complete the async each limit series', function(done) {
      var addresses = [address];
      var history = new AddressHistory({
        node: {},
        options: {},
        addresses: addresses
      });
      var expected = [{}];
      history.detailedArray = expected;
      history.combinedArray = [{}];
      history.getTransactionInfo = sinon.stub().callsArg(1);
      history.combineTransactionInfo = sinon.stub();
      history.sortAndPaginateCombinedArray = sinon.stub();
      history.getDetailedInfo = sinon.stub().callsArg(1);
      history.sortTransactionsIntoArray = sinon.stub();
      history.get(function(err, results) {
        if (err) {
          throw err;
        }
        history.getTransactionInfo.callCount.should.equal(1);
        history.getDetailedInfo.callCount.should.equal(1);
        history.combineTransactionInfo.callCount.should.equal(1);
        history.sortAndPaginateCombinedArray.callCount.should.equal(1);
        results.should.deep.equal({
          totalCount: 1,
          items: expected
        });
        done();
      });
    });
    it('handle an error from getDetailedInfo', function(done) {
      var addresses = [address];
      var history = new AddressHistory({
        node: {},
        options: {},
        addresses: addresses
      });
      var expected = [{}];
      history.sortedArray = expected;
      history.transactionInfo = [{}];
      history.getTransactionInfo = sinon.stub().callsArg(1);
      history.paginateSortedArray = sinon.stub();
      history.getDetailedInfo = sinon.stub().callsArgWith(1, new Error('test'));
      history.get(function(err) {
        err.message.should.equal('test');
        done();
      });
    });
    it('handle an error from getTransactionInfo', function(done) {
      var addresses = [address];
      var history = new AddressHistory({
        node: {},
        options: {},
        addresses: addresses
      });
      var expected = [{}];
      history.sortedArray = expected;
      history.transactionInfo = [{}];
      history.getTransactionInfo = sinon.stub().callsArgWith(1, new Error('test'));
      history.get(function(err) {
        err.message.should.equal('test');
        done();
      });
    });
  });

  describe('#getTransactionInfo', function() {
    it('will handle an error from getInputs', function(done) {
      var history = new AddressHistory({
        node: {
          services: {
            address: {
              getOutputs: sinon.stub().callsArgWith(2, null, []),
              getInputs: sinon.stub().callsArgWith(2, new Error('test'))
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getTransactionInfo(address, function(err) {
        err.message.should.equal('test');
        done();
      });
    });
    it('will handle an error from getOutputs', function(done) {
      var history = new AddressHistory({
        node: {
          services: {
            address: {
              getOutputs: sinon.stub().callsArgWith(2, new Error('test')),
              getInputs: sinon.stub().callsArgWith(2, null, [])
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getTransactionInfo(address, function(err) {
        err.message.should.equal('test');
        done();
      });
    });
    it('will call getOutputs and getInputs with the correct options', function() {
      var startTimestamp = 1438289011844;
      var endTimestamp = 1438289012412;
      var expectedArgs = {
        start: new Date(startTimestamp * 1000),
        end: new Date(endTimestamp * 1000),
        queryMempool: true
      };
      var history = new AddressHistory({
        node: {
          services: {
            address: {
              getOutputs: sinon.stub().callsArgWith(2, null, []),
              getInputs: sinon.stub().callsArgWith(2, null, [])
            }
          }
        },
        options: {
          start: new Date(startTimestamp * 1000),
          end: new Date(endTimestamp * 1000),
          queryMempool: true
        },
        addresses: []
      });
      history.transactionInfo = [{}];
      history.getTransactionInfo(address, function(err) {
        if (err) {
          throw err;
        }
        history.node.services.address.getOutputs.args[0][1].should.deep.equal(expectedArgs);
        history.node.services.address.getInputs.args[0][1].should.deep.equal(expectedArgs);
      });
    });
    it('will handle empty results from getOutputs and getInputs', function() {
      var history = new AddressHistory({
        node: {
          services: {
            address: {
              getOutputs: sinon.stub().callsArgWith(2, null, []),
              getInputs: sinon.stub().callsArgWith(2, null, [])
            }
          }
        },
        options: {},
        addresses: []
      });
      history.transactionInfo = [{}];
      history.getTransactionInfo(address, function(err) {
        if (err) {
          throw err;
        }
        history.transactionInfo.length.should.equal(1);
        history.node.services.address.getOutputs.args[0][0].should.equal(address);
      });
    });
    it('will concatenate outputs and inputs', function() {
      var history = new AddressHistory({
        node: {
          services: {
            address: {
              getOutputs: sinon.stub().callsArgWith(2, null, [{}]),
              getInputs: sinon.stub().callsArgWith(2, null, [{}])
            }
          }
        },
        options: {},
        addresses: []
      });
      history.transactionInfo = [{}];
      history.getTransactionInfo(address, function(err) {
        if (err) {
          throw err;
        }
        history.transactionInfo.length.should.equal(3);
        history.node.services.address.getOutputs.args[0][0].should.equal(address);
      });
    });
  });

  describe('@sortByHeight', function() {
    it('will sort latest to oldest using height', function() {
      var transactionInfo = [
        {
          height: 276328
        },
        {
          height: 273845,
        },
        {
          height: 555655
        },
        {
          height: 325496
        },
        {
          height: 329186
        },
        {
          height: 534195
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].height.should.equal(555655);
      transactionInfo[1].height.should.equal(534195);
      transactionInfo[2].height.should.equal(329186);
      transactionInfo[3].height.should.equal(325496);
      transactionInfo[4].height.should.equal(276328);
      transactionInfo[5].height.should.equal(273845);
    });
    it('mempool and tip with time in the future', function() {
      var transactionInfo = [
        {
          timestamp: 1442050425439,
          height: 14,
        },
        {
          timestamp: 1442050424328,
          height: -1
        },
        {
          timestamp: 1442050424429,
          height: -1
        },
        {
          timestamp: 1442050425439,
          height: 15
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].height.should.equal(-1);
      transactionInfo[0].timestamp.should.equal(1442050424429);
      transactionInfo[1].height.should.equal(-1);
      transactionInfo[1].timestamp.should.equal(1442050424328);
      transactionInfo[2].height.should.equal(15);
      transactionInfo[3].height.should.equal(14);
    });
    it('tip with time in the future and mempool', function() {
      var transactionInfo = [
        {
          timestamp: 1442050425439,
          height: 14,
        },
        {
          timestamp: 1442050424328,
          height: -1
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].height.should.equal(-1);
      transactionInfo[1].height.should.equal(14);
    });
    it('many transactions in the mempool', function() {
      var transactionInfo = [
        {
          timestamp: 1442259670462,
          height: -1
        },
        {
          timestamp: 1442259785114,
          height: -1
        },
        {
          timestamp: 1442259759896,
          height: -1
        },
        {
          timestamp: 1442259692601,
          height: -1
        },
        {
          timestamp: 1442259692601,
          height: 100
        },
        {
          timestamp: 1442259749463,
          height: -1
        },
        {
          timestamp: 1442259737719,
          height: -1
        },
        {
          timestamp: 1442259773138,
          height: -1,
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].timestamp.should.equal(1442259785114);
      transactionInfo[1].timestamp.should.equal(1442259773138);
      transactionInfo[2].timestamp.should.equal(1442259759896);
      transactionInfo[3].timestamp.should.equal(1442259749463);
      transactionInfo[4].timestamp.should.equal(1442259737719);
      transactionInfo[5].timestamp.should.equal(1442259692601);
      transactionInfo[6].timestamp.should.equal(1442259670462);
      transactionInfo[7].height.should.equal(100);
    });
    it('mempool and mempool', function() {
      var transactionInfo = [
        {
          timestamp: 1442050424328,
          height: -1
        },
        {
          timestamp: 1442050425439,
          height: -1,
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].timestamp.should.equal(1442050425439);
      transactionInfo[1].timestamp.should.equal(1442050424328);
    });
    it('mempool and mempool with the same timestamp', function() {
      var transactionInfo = [
        {
          timestamp: 1442050425439,
          height: -1,
          txid: '1',
        },
        {
          timestamp: 1442050425439,
          height: -1,
          txid: '2'
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].txid.should.equal('1');
      transactionInfo[1].txid.should.equal('2');
    });
    it('matching block heights', function() {
      var transactionInfo = [
        {
          height: 325496,
          txid: '1',
        },
        {
          height: 325496,
          txid: '2'
        }
      ];
      transactionInfo.sort(AddressHistory.sortByHeight);
      transactionInfo[0].txid.should.equal('1');
      transactionInfo[1].txid.should.equal('2');
    });
  });

  describe('#sortAndPaginateCombinedArray', function() {
    it('from 0 to 2', function() {
      var history = new AddressHistory({
        node: {},
        options: {
          from: 0,
          to: 2
        },
        addresses: []
      });
      history.combinedArray = [
        {
          height: 13
        },
        {
          height: 14,
        },
        {
          height: 12
        }
      ];
      history.sortAndPaginateCombinedArray();
      history.combinedArray.length.should.equal(2);
      history.combinedArray[0].height.should.equal(14);
      history.combinedArray[1].height.should.equal(13);
    });
    it('from 0 to 4 (exceeds length)', function() {
      var history = new AddressHistory({
        node: {},
        options: {
          from: 0,
          to: 4
        },
        addresses: []
      });
      history.combinedArray = [
        {
          height: 13
        },
        {
          height: 14,
        },
        {
          height: 12
        }
      ];
      history.sortAndPaginateCombinedArray();
      history.combinedArray.length.should.equal(3);
      history.combinedArray[0].height.should.equal(14);
      history.combinedArray[1].height.should.equal(13);
      history.combinedArray[2].height.should.equal(12);
    });
    it('from 0 to 1', function() {
      var history = new AddressHistory({
        node: {},
        options: {
          from: 0,
          to: 1
        },
        addresses: []
      });
      history.combinedArray = [
        {
          height: 13
        },
        {
          height: 14,
        },
        {
          height: 12
        }
      ];
      history.sortAndPaginateCombinedArray();
      history.combinedArray.length.should.equal(1);
      history.combinedArray[0].height.should.equal(14);
    });
    it('from 2 to 3', function() {
      var history = new AddressHistory({
        node: {},
        options: {
          from: 2,
          to: 3
        },
        addresses: []
      });
      history.combinedArray = [
        {
          height: 13
        },
        {
          height: 14,
        },
        {
          height: 12
        }
      ];
      history.sortAndPaginateCombinedArray();
      history.combinedArray.length.should.equal(1);
      history.combinedArray[0].height.should.equal(12);
    });
    it('from 10 to 20 (out of range)', function() {
      var history = new AddressHistory({
        node: {},
        options: {
          from: 10,
          to: 20
        },
        addresses: []
      });
      history.combinedArray = [
        {
          height: 13
        },
        {
          height: 14,
        },
        {
          height: 12
        }
      ];
      history.sortAndPaginateCombinedArray();
      history.combinedArray.length.should.equal(0);
    });
  });

  describe('#getDetailedInfo', function() {
    it('will add additional information to existing this.transactions', function() {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              getTransactionWithBlockInfo: sinon.stub()
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getDetailedInfo(txid, function(err) {
        if (err) {
          throw err;
        }
        history.node.services.db.getTransactionsWithBlockInfo.callCount.should.equal(0);
      });
    });
    it('will handle error from getTransactionFromBlock', function() {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, new Error('test')),
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getDetailedInfo(txid, function(err) {
        err.message.should.equal('test');
      });
    });
    it('will handle error from populateInputs', function() {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, null, {
                populateInputs: sinon.stub().callsArgWith(2, new Error('test'))
              }),
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getDetailedInfo(txid, function(err) {
        err.message.should.equal('test');
      });
    });
    it('will set this.transactions with correct information', function() {
      // block #314159
      // txid 30169e8bf78bc27c4014a7aba3862c60e2e3cce19e52f1909c8255e4b7b3174e
      // outputIndex 1
      var txAddress = '1Cj4UZWnGWAJH1CweTMgPLQMn26WRMfXmo';
      var txString = '0100000001a08ee59fcd5d86fa170abb6d925d62d5c5c476359681b70877c04f270c4ef246000000008a47304402203fb9b476bb0c37c9b9ed5784ebd67ae589492be11d4ae1612be29887e3e4ce750220741ef83781d1b3a5df8c66fa1957ad0398c733005310d7d9b1d8c2310ef4f74c0141046516ad02713e51ecf23ac9378f1069f9ae98e7de2f2edbf46b7836096e5dce95a05455cc87eaa1db64f39b0c63c0a23a3b8df1453dbd1c8317f967c65223cdf8ffffffff02b0a75fac000000001976a91484b45b9bf3add8f7a0f3daad305fdaf6b73441ea88ac20badc02000000001976a914809dc14496f99b6deb722cf46d89d22f4beb8efd88ac00000000';
      var previousTxString = '010000000155532fad2869bb951b0bd646a546887f6ee668c4c0ee13bf3f1c4bce6d6e3ed9000000008c4930460221008540795f4ef79b1d2549c400c61155ca5abbf3089c84ad280e1ba6db2a31abce022100d7d162175483d51174d40bba722e721542c924202a0c2970b07e680b51f3a0670141046516ad02713e51ecf23ac9378f1069f9ae98e7de2f2edbf46b7836096e5dce95a05455cc87eaa1db64f39b0c63c0a23a3b8df1453dbd1c8317f967c65223cdf8ffffffff02f0af3caf000000001976a91484b45b9bf3add8f7a0f3daad305fdaf6b73441ea88ac80969800000000001976a91421277e65777760d1f3c7c982ba14ed8f934f005888ac00000000';
      var transaction = new Transaction();
      var previousTransaction = new Transaction();
      previousTransaction.fromString(previousTxString);
      var previousTransactionTxid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      transaction.fromString(txString);
      var txid = transaction.hash;
      transaction.__blockHash = '00000000000000001bb82a7f5973618cfd3185ba1ded04dd852a653f92a27c45';
      transaction.__height = 314159;
      transaction.__timestamp = 1407292005;
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              tip: {
                __height: 314159
              },
              getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, null, transaction),
              getTransaction: function(prevTxid, queryMempool, callback) {
                prevTxid.should.equal(previousTransactionTxid);
                setImmediate(function() {
                  callback(null, previousTransaction);
                });
              }
            }
          }
        },
        options: {},
        addresses: []
      });
      var transactionInfo = {
        addresses: {},
        txid: txid,
        timestamp: 1407292005,
        satoshis: 48020000,
        address: txAddress
      };
      transactionInfo.addresses[txAddress] = {};
      transactionInfo.addresses[txAddress].outputIndexes = [1];
      transactionInfo.addresses[txAddress].inputIndexes = [];
      history.getDetailedInfo(transactionInfo, function(err) {
        if (err) {
          throw err;
        }
        var info = history.detailedArray[0];
        info.addresses[txAddress].should.deep.equal({
          outputIndexes: [1],
          inputIndexes: []
        });
        info.satoshis.should.equal(48020000);
        info.height.should.equal(314159);
        info.confirmations.should.equal(1);
        info.timestamp.should.equal(1407292005);
        info.fees.should.equal(20000);
        info.tx.should.equal(transaction);
      });
    });
  });
  describe('#getConfirmationsDetail', function() {
    it('the correct confirmations when included in the tip', function() {
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              tip: {
                __height: 100
              }
            }
          }
        },
        options: {},
        addresses: []
      });
      var transaction = {
        __height: 100
      };
      history.getConfirmationsDetail(transaction).should.equal(1);
    });
  });
  describe('#getSatoshisDetail', function() {
    it('subtract inputIndexes satoshis without outputIndexes', function() {
      var history = new AddressHistory({
        node: {},
        options: {},
        addresses: []
      });
      var transaction = {
        inputs: [
          {
            output: {
              satoshis: 10000
            }
          }
        ]
      };
      var txInfo = {
        addresses: {}
      };
      txInfo.addresses[address] = {};
      txInfo.addresses[address].inputIndexes = [0];
      history.getSatoshisDetail(transaction, txInfo).should.equal(-10000);
    });
  });
});
