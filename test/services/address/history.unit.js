'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcore = require('bitcore-lib');
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
    it('will give an error if length of addresses is too long', function(done) {
      var node = {};
      var options = {};
      var addresses = [];
      for (var i = 0; i < 101; i++) {
        addresses.push(address);
      }
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history.maxAddressesQuery = 100;
      history.get(function(err) {
        should.exist(err);
        err.message.match(/Maximum/);
        done();
      });
    });
    it('give error from getAddressSummary with one address', function(done) {
      var node = {
        services: {
          address: {
            getAddressSummary: sinon.stub().callsArgWith(2, new Error('test'))
          }
        }
      };
      var options = {};
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history.get(function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });
    it('give error from getAddressSummary with multiple addresses', function(done) {
      var node = {
        services: {
          address: {
            getAddressSummary: sinon.stub().callsArgWith(2, new Error('test2'))
          }
        }
      };
      var options = {};
      var addresses = [address, address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history.get(function(err) {
        should.exist(err);
        err.message.should.equal('test2');
        done();
      });
    });
    it('will query get address summary directly with one address', function(done) {
      var txids = [];
      var summary = {
        txids: txids
      };
      var node = {
        services: {
          address: {
            getAddressSummary: sinon.stub().callsArgWith(2, null, summary)
          }
        }
      };
      var options = {};
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history._mergeAndSortTxids = sinon.stub();
      history._paginateWithDetails = sinon.stub().callsArg(1);
      history.get(function() {
        history.node.services.address.getAddressSummary.callCount.should.equal(1);
        history.node.services.address.getAddressSummary.args[0][0].should.equal(address);
        history.node.services.address.getAddressSummary.args[0][1].should.deep.equal({
          noBalance: true,
        });
        history._paginateWithDetails.callCount.should.equal(1);
        history._paginateWithDetails.args[0][0].should.equal(txids);
        history._mergeAndSortTxids.callCount.should.equal(0);
        done();
      });
    });
    it('will merge multiple summaries with multiple addresses', function(done) {
      var txids = [];
      var summary = {
        txids: txids
      };
      var node = {
        services: {
          address: {
            getAddressSummary: sinon.stub().callsArgWith(2, null, summary)
          }
        }
      };
      var options = {};
      var addresses = [address, address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      history._mergeAndSortTxids = sinon.stub().returns(txids);
      history._paginateWithDetails = sinon.stub().callsArg(1);
      history.get(function() {
        history.node.services.address.getAddressSummary.callCount.should.equal(2);
        history.node.services.address.getAddressSummary.args[0][0].should.equal(address);
        history.node.services.address.getAddressSummary.args[0][1].should.deep.equal({
          fullTxList: true,
          noBalance: true,
        });
        history._paginateWithDetails.callCount.should.equal(1);
        history._paginateWithDetails.args[0][0].should.equal(txids);
        history._mergeAndSortTxids.callCount.should.equal(1);
        done();
      });
    });
  });

  describe('#_paginateWithDetails', function() {
    it('slice txids based on "from" and "to" (3 to 30)', function() {
      var node = {};
      var options = {
        from: 3,
        to: 30
      };
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      sinon.stub(history, 'getDetailedInfo', function(txid, next) {
        this.detailedArray.push(txid);
        next();
      });
      history._paginateWithDetails(txids, function(err, result) {
        result.totalCount.should.equal(11);
        result.items.should.deep.equal([7, 6, 5, 4, 3, 2, 1, 0]);
      });
    });
    it('slice txids based on "from" and "to" (0 to 3)', function() {
      var node = {};
      var options = {
        from: 0,
        to: 3
      };
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      sinon.stub(history, 'getDetailedInfo', function(txid, next) {
        this.detailedArray.push(txid);
        next();
      });
      history._paginateWithDetails(txids, function(err, result) {
        result.totalCount.should.equal(11);
        result.items.should.deep.equal([10, 9, 8]);
      });
    });
    it('will given an error if the full details is too long', function() {
      var node = {};
      var options = {
        from: 0,
        to: 3
      };
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      sinon.stub(history, 'getDetailedInfo', function(txid, next) {
        this.detailedArray.push(txid);
        next();
      });
      history.maxHistoryQueryLength = 1;
      history._paginateWithDetails(txids, function(err) {
        should.exist(err);
        err.message.match(/Maximum/);
      });
    });
    it('will give full result without pagination options', function() {
      var node = {};
      var options = {};
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      var txids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      sinon.stub(history, 'getDetailedInfo', function(txid, next) {
        this.detailedArray.push(txid);
        next();
      });
      history._paginateWithDetails(txids, function(err, result) {
        result.totalCount.should.equal(11);
        result.items.should.deep.equal([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
      });
    });
  });

  describe('#_mergeAndSortTxids', function() {
    it('will merge and sort multiple summaries', function() {
      var summaries = [
        {
          totalReceived: 10000000,
          totalSpent: 0,
          balance: 10000000,
          appearances: 2,
          unconfirmedBalance: 20000000,
          unconfirmedAppearances: 2,
          appearanceIds: {
            '56fafeb01961831b926558d040c246b97709fd700adcaa916541270583e8e579': 154,
            'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce': 120
          },
          unconfirmedAppearanceIds: {
            'ec94d845c603f292a93b7c829811ac624b76e52b351617ca5a758e9d61a11681': 1452898347406,
            'ed11a08e3102f9610bda44c80c46781d97936a4290691d87244b1b345b39a693': 1452898331964
          }
        },
        {
          totalReceived: 59990000,
          totalSpent: 0,
          balance: 49990000,
          appearances: 3,
          unconfirmedBalance: 1000000,
          unconfirmedAppearances: 3,
          appearanceIds: {
            'bc992ad772eb02864db07ef248d31fb3c6826d25f1153ebf8c79df9b7f70fcf2': 156,
            'f3c1ba3ef86a0420d6102e40e2cfc8682632ab95d09d86a27f5d466b9fa9da47': 152,
            'f637384e9f81f18767ea50e00bce58fc9848b6588a1130529eebba22a410155f': 151
          },
          unconfirmedAppearanceIds: {
            'f71bccef3a8f5609c7f016154922adbfe0194a96fb17a798c24077c18d0a9345': 1452897902377,
            'edc080f2084eed362aa488ccc873a24c378dc0979aa29b05767517b70569414a': 1452897971363,
            'f35e7e2a2334e845946f3eaca76890d9a68f4393ccc9fe37a0c2fb035f66d2e9': 1452897923107
          }
        }
      ];
      var node = {};
      var options = {};
      var addresses = [address];
      var history = new AddressHistory({
        node: node,
        options: options,
        addresses: addresses
      });
      var txids = history._mergeAndSortTxids(summaries);
      txids.should.deep.equal([
        'e9dcf22807db77ac0276b03cc2d3a8b03c4837db8ac6650501ef45af1c807cce',
        'f637384e9f81f18767ea50e00bce58fc9848b6588a1130529eebba22a410155f',
        'f3c1ba3ef86a0420d6102e40e2cfc8682632ab95d09d86a27f5d466b9fa9da47',
        '56fafeb01961831b926558d040c246b97709fd700adcaa916541270583e8e579',
        'bc992ad772eb02864db07ef248d31fb3c6826d25f1153ebf8c79df9b7f70fcf2',
        'f71bccef3a8f5609c7f016154922adbfe0194a96fb17a798c24077c18d0a9345',
        'f35e7e2a2334e845946f3eaca76890d9a68f4393ccc9fe37a0c2fb035f66d2e9',
        'edc080f2084eed362aa488ccc873a24c378dc0979aa29b05767517b70569414a',
        'ed11a08e3102f9610bda44c80c46781d97936a4290691d87244b1b345b39a693',
        'ec94d845c603f292a93b7c829811ac624b76e52b351617ca5a758e9d61a11681'
      ]);
    });
  });

  describe('#getDetailedInfo', function() {
    it('will add additional information to existing this.transactions', function(done) {
      var txid = '46f24e0c274fc07708b781963576c4c5d5625d926dbb0a17fa865dcd9fe58ea0';
      var tx = {
        populateInputs: sinon.stub().callsArg(2),
        __height: 20,
        __timestamp: 1453134151,
        isCoinbase: sinon.stub().returns(false),
        getFee: sinon.stub().returns(1000)
      };
      var history = new AddressHistory({
        node: {
          services: {
            db: {
              getTransactionWithBlockInfo: sinon.stub().callsArgWith(2, null, tx),
              tip: {
                __height: 300
              }
            }
          }
        },
        options: {},
        addresses: []
      });
      history.getAddressDetailsForTransaction = sinon.stub().returns({
        addresses: {},
        satoshis: 1000,
      });
      history.getDetailedInfo(txid, function(err) {
        if (err) {
          throw err;
        }
        history.node.services.db.getTransactionWithBlockInfo.callCount.should.equal(1);
        done();
      });
    });
    it('will handle error from getTransactionFromBlock', function(done) {
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
        done();
      });
    });
    it('will handle error from populateInputs', function(done) {
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
        done();
      });
    });
    it('will set this.transactions with correct information', function(done) {
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
        addresses: [txAddress]
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
      history.getDetailedInfo(txid, function(err) {
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
        done();
      });
    });
  });

  describe('#getAddressDetailsForTransaction', function() {
    it('will calculate details for the transaction', function(done) {
      /* jshint sub:true */
      var tx = bitcore.Transaction({
        'hash': 'b12b3ae8489c5a566b629a3c62ce4c51c3870af550fb5dc77d715b669a91343c',
        'version': 1,
        'inputs': [
          {
            'prevTxId': 'a2b7ea824a92f4a4944686e67ec1001bc8785348b8c111c226f782084077b543',
            'outputIndex': 0,
            'sequenceNumber': 4294967295,
            'script': '47304402201b81c933297241960a57ae1b2952863b965ac8c9ec7466ff0b715712d27548d50220576e115b63864f003889443525f47c7cf0bc1e2b5108398da085b221f267ba2301210229766f1afa25ca499a51f8e01c292b0255a21a41bb6685564a1607a811ffe924',
            'scriptString': '71 0x304402201b81c933297241960a57ae1b2952863b965ac8c9ec7466ff0b715712d27548d50220576e115b63864f003889443525f47c7cf0bc1e2b5108398da085b221f267ba2301 33 0x0229766f1afa25ca499a51f8e01c292b0255a21a41bb6685564a1607a811ffe924',
            'output': {
              'satoshis': 1000000000,
              'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
            }
          }
        ],
        'outputs': [
          {
            'satoshis': 100000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 200000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 50000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 300000000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          },
          {
            'satoshis': 349990000,
            'script': '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac'
          }
        ],
        'nLockTime': 0
      });
      var history = new AddressHistory({
        node: {
          network: bitcore.Networks.testnet
        },
        options: {},
        addresses: ['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW']
      });
      var details = history.getAddressDetailsForTransaction(tx);
      should.exist(details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW']);
      details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'].inputIndexes.should.deep.equal([0]);
      details.addresses['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'].outputIndexes.should.deep.equal([
        0, 1, 2, 3, 4
      ]);
      details.satoshis.should.equal(-10000);
      done();
    });
  });

  describe('#getConfirmationsDetail', function() {
    it('the correct confirmations when included in the tip', function(done) {
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
      done();
    });
  });
});
