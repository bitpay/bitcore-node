'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var stream = require('stream');
var levelup = require('levelup');
var proxyquire = require('proxyquire');
var bitcorenode = require('../../../');
var AddressService = bitcorenode.services.Address;
var blockData = require('../../data/livenet-345003.json');
var bitcore = require('bitcore-lib');
var memdown = require('memdown');
var leveldown = require('leveldown');
var Networks = bitcore.Networks;
var EventEmitter = require('events').EventEmitter;
var errors = bitcorenode.errors;
var Transaction = require('../../../lib/transaction');
var txData = require('../../data/transaction.json');
var index = require('../../../lib');
var log = index.log;
var constants = require('../../../lib/services/address/constants');
var encoding = require('../../../lib/services/address/encoding');

var mockdb = {
};

var mocknode = {
  network: Networks.testnet,
  datadir: 'testdir',
  db: mockdb,
  services: {
    bitcoind: {
      on: sinon.stub()
    }
  }
};

describe('Address Service', function() {
  var txBuf = new Buffer(txData[0], 'hex');

  describe('@constructor', function() {
    it('config to use memdown for mempool index', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.levelupStore.should.equal(memdown);
    });
    it('config to use leveldown for mempool index', function() {
      var am = new AddressService({
        node: mocknode
      });
      am.levelupStore.should.equal(leveldown);
    });
  });

  describe('#start', function() {
    it('will flush existing mempool', function(done) {
      var leveldownmock = {
        destroy: sinon.stub().callsArgWith(1, null)
      };
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(true)
        },
        'leveldown': leveldownmock,
        'levelup': sinon.stub().callsArgWith(2, null),
        'mkdirp': sinon.stub().callsArgWith(1, null)
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function() {
        leveldownmock.destroy.callCount.should.equal(1);
        leveldownmock.destroy.args[0][0].should.equal('testdir/testnet3/bitcore-addressmempool.db');
        done();
      });
    });
    it('will mkdirp if directory does not exist', function(done) {
      var leveldownmock = {
        destroy: sinon.stub().callsArgWith(1, null)
      };
      var mkdirpmock = sinon.stub().callsArgWith(1, null);
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(false)
        },
        'leveldown': leveldownmock,
        'levelup': sinon.stub().callsArgWith(2, null),
        'mkdirp': mkdirpmock
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function() {
        mkdirpmock.callCount.should.equal(1);
        mkdirpmock.args[0][0].should.equal('testdir/testnet3/bitcore-addressmempool.db');
        done();
      });
    });
    it('start levelup db for mempool and summary index', function(done) {
      var levelupStub = sinon.stub().callsArg(2);
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(true)
        },
        'leveldown': {
          destroy: sinon.stub().callsArgWith(1, null)
        },
        'levelup': levelupStub,
        'mkdirp': sinon.stub().callsArgWith(1, null)
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function() {
        levelupStub.callCount.should.equal(2);
        var dbPath1 = levelupStub.args[0][0];
        dbPath1.should.equal('testdir/testnet3/bitcore-addressmempool.db');
        var options = levelupStub.args[0][1];
        options.db.should.equal(memdown);
        options.keyEncoding.should.equal('binary');
        options.valueEncoding.should.equal('binary');
        options.fillCache.should.equal(false);
        var dbPath2 = levelupStub.args[1][0];
        dbPath2.should.equal('testdir/testnet3/bitcore-addresssummary.db');
        done();
      });
    });
    it('handle error from mkdirp', function(done) {
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(false)
        },
        'leveldown': {
          destroy: sinon.stub().callsArgWith(1, null)
        },
        'levelup': sinon.stub().callsArgWith(2, null),
        'mkdirp': sinon.stub().callsArgWith(1, new Error('testerror'))
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function(err) {
        err.message.should.equal('testerror');
        done();
      });
    });
    it('handle error from levelup', function(done) {
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(false)
        },
        'leveldown': {
          destroy: sinon.stub().callsArgWith(1, null)
        },
        'levelup': sinon.stub().callsArgWith(2, new Error('leveltesterror')),
        'mkdirp': sinon.stub().callsArgWith(1, null)
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function(err) {
        err.message.should.equal('leveltesterror');
        done();
      });
    });
    it('handle error from leveldown.destroy', function(done) {
      var TestAddressService = proxyquire('../../../lib/services/address', {
        'fs': {
          existsSync: sinon.stub().returns(true)
        },
        'leveldown': {
          destroy: sinon.stub().callsArgWith(1, new Error('destroy'))
        },
        'levelup': sinon.stub().callsArgWith(2, null),
        'mkdirp': sinon.stub().callsArgWith(1, null)
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.start(function(err) {
        err.message.should.equal('destroy');
        done();
      });
    });
  });

  describe('#stop', function() {
    it('will close mempool levelup', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.mempoolIndex = {};
      am.mempoolIndex.close = sinon.stub().callsArg(0);
      am.stop(function() {
        am.mempoolIndex.close.callCount.should.equal(1);
        done();
      });
    });
  });

  describe('#_setMempoolIndexPath', function() {
    it('should set the database path', function() {
      var testnode = {
        network: Networks.livenet,
        datadir: process.env.HOME + '/.bitcoin',
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am._setMempoolIndexPath();
      am.mempoolIndexPath.should.equal(process.env.HOME + '/.bitcoin/bitcore-addressmempool.db');
    });
    it('should load the db for testnet', function() {
      var testnode = {
        network: Networks.testnet,
        datadir: process.env.HOME + '/.bitcoin',
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am._setMempoolIndexPath();
      am.mempoolIndexPath.should.equal(process.env.HOME + '/.bitcoin/testnet3/bitcore-addressmempool.db');
    });
    it('error with unknown network', function() {
      var testnode = {
        network: 'unknown',
        datadir: process.env.HOME + '/.bitcoin',
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      (function() {
        var am = new AddressService({
          mempoolMemoryIndex: true,
          node: testnode
        });
      }).should.throw('Unknown network');
    });
    it('should load the db with regtest', function() {
      // Switch to use regtest
      Networks.remove(Networks.testnet);
      Networks.add({
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
      var regtest = Networks.get('regtest');
      var testnode = {
        network: regtest,
        datadir: process.env.HOME + '/.bitcoin',
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.mempoolIndexPath.should.equal(process.env.HOME + '/.bitcoin/regtest/bitcore-addressmempool.db');
      Networks.remove(regtest);
    });
  });

  describe('#getAPIMethods', function() {
    it('should return the correct methods', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var methods = am.getAPIMethods();
      methods.length.should.equal(7);
    });
  });

  describe('#getPublishEvents', function() {
    it('will return an array of publish event objects', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.subscribe = sinon.spy();
      am.unsubscribe = sinon.spy();
      var events = am.getPublishEvents();

      var callCount = 0;
      function testName(event, name) {
        event.name.should.equal(name);
        event.scope.should.equal(am);
        var emitter = new EventEmitter();
        var addresses = [];
        event.subscribe(emitter, addresses);
        am.subscribe.callCount.should.equal(callCount + 1);
        am.subscribe.args[callCount][0].should.equal(name);
        am.subscribe.args[callCount][1].should.equal(emitter);
        am.subscribe.args[callCount][2].should.equal(addresses);
        am.subscribe.thisValues[callCount].should.equal(am);
        event.unsubscribe(emitter, addresses);
        am.unsubscribe.callCount.should.equal(callCount + 1);
        am.unsubscribe.args[callCount][0].should.equal(name);
        am.unsubscribe.args[callCount][1].should.equal(emitter);
        am.unsubscribe.args[callCount][2].should.equal(addresses);
        am.unsubscribe.thisValues[callCount].should.equal(am);
        callCount++;
      }
      events.forEach(function(event) {
        testName(event, event.name);
      });

    });
  });

  describe('#transactionOutputHandler', function() {
    it('create a message for an address', function() {
      var txBuf = new Buffer('01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000', 'hex');
      var tx = bitcore.Transaction().fromBuffer(txBuf);
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.node.network = Networks.livenet;
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var addrObj = bitcore.Address(address);
      var hashHex = addrObj.hashBuffer.toString('hex');
      var hashType = addrObj.type;
      var messages = {};
      am.transactionOutputHandler(messages, tx, 0, true);
      should.exist(messages[hashHex]);
      var message = messages[hashHex];
      message.tx.should.equal(tx);
      message.outputIndexes.should.deep.equal([0]);
      message.addressInfo.hashBuffer.toString('hex').should.equal(hashHex);
      message.addressInfo.addressType.should.equal(hashType);
      message.addressInfo.hashHex.should.equal(hashHex);
      message.rejected.should.equal(true);
    });
  });

  describe('#transactionHandler', function() {
    it('will pass outputs to transactionOutputHandler and call transactionEventHandler and balanceEventHandler', function(done) {
      var txBuf = new Buffer('01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000', 'hex');
      var am1 = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var message = {};
      am1.transactionOutputHandler = function(messages) {
        messages[address] = message;
      };
      am1.transactionEventHandler = sinon.stub();
      am1.balanceEventHandler = sinon.stub();
      am1.transactionHandler({
        buffer: txBuf
      }, function(err) {
        if (err) {
          throw err;
        }
        am1.transactionEventHandler.callCount.should.equal(1);
        am1.balanceEventHandler.callCount.should.equal(1);
        done();
      });

    });
  });

  describe('#blockHandler', function() {
    var am;
    var testBlock = bitcore.Block.fromString(blockData);

    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.node.network = Networks.livenet;
    });

    it('should create the correct operations when updating/adding outputs', function(done) {
      var block = {
        __height: 345003,
        header: {
          timestamp: 1424836934
        },
        transactions: testBlock.transactions.slice(0, 8)
      };

      am.blockHandler(block, true, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(151);
        operations[0].type.should.equal('put');
        operations[0].key.toString('hex').should.equal('0202a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b0100000543abfdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e1692300000000');
        operations[0].value.toString('hex').should.equal('41e2a49ec1c0000076a91402a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b88ac');
        operations[3].type.should.equal('put');
        operations[3].key.toString('hex').should.equal('03fdbd324b28ea69e49c998816407dc055fb81d06e0100000543ab3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a900000020');
        operations[3].value.toString('hex').should.equal('5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca00000000');
        operations[4].type.should.equal('put');
        operations[4].key.toString('hex').should.equal('053d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a900000020');
        operations[4].value.toString('hex').should.equal('5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca00000000');
        operations[121].type.should.equal('put');
        operations[121].key.toString('hex').should.equal('029780ccd5356e2acc0ee439ee04e0fe69426c75280100000543abe66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d00000001');
        operations[121].value.toString('hex').should.equal('4147a6b00000000076a9149780ccd5356e2acc0ee439ee04e0fe69426c752888ac');
        done();
      });
    });
    it('should create the correct operations when removing outputs', function(done) {
      var block = {
        __height: 345003,
        header: {
          timestamp: 1424836934
        },
        transactions: testBlock.transactions.slice(0, 8)
      };
      am.blockHandler(block, false, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(151);
        operations[0].type.should.equal('del');
        operations[0].key.toString('hex').should.equal('0202a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b0100000543abfdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e1692300000000');
        operations[0].value.toString('hex').should.equal('41e2a49ec1c0000076a91402a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b88ac');
        operations[3].type.should.equal('del');
        operations[3].key.toString('hex').should.equal('03fdbd324b28ea69e49c998816407dc055fb81d06e0100000543ab3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a900000020');
        operations[3].value.toString('hex').should.equal('5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca00000000');
        operations[121].type.should.equal('del');
        operations[121].key.toString('hex').should.equal('029780ccd5356e2acc0ee439ee04e0fe69426c75280100000543abe66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d00000001');
        operations[121].value.toString('hex').should.equal('4147a6b00000000076a9149780ccd5356e2acc0ee439ee04e0fe69426c752888ac');
        done();
      });
    });
    it('should continue if output script is null', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode,
      });

      var block = {
        __height: 345003,
        header: {
          timestamp: 1424836934
        },
        transactions: [
          {
            id: '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7',
            inputs: [],
            outputs: [
              {
                script: null,
                satoshis: 1000,
              }
            ],
            isCoinbase: sinon.stub().returns(false)
          }
        ]
      };

      am.blockHandler(block, false, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(0);
        done();
      });
    });
    it('will call event handlers', function() {
      var testBlock = bitcore.Block.fromString(blockData);
      var db = {};
      var testnode = {
        datadir: 'testdir',
        db: db,
        network: Networks.testnet,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.transactionEventHandler = sinon.spy();
      am.balanceEventHandler = sinon.spy();

      var block = {
        __height: 345003,
        header: {
          timestamp: 1424836934
        },
        transactions: testBlock.transactions.slice(0, 8)
      };

      am.blockHandler(
        block,
        true,
        function(err) {
          if (err) {
            throw err;
          }
          am.transactionEventHandler.callCount.should.equal(11);
          am.balanceEventHandler.callCount.should.equal(11);
        }
      );
    });
  });

  describe('#transactionEventHandler', function() {
    it('will emit a transaction if there is a subscriber', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      am.subscriptions['address/transaction'] = {};
      am.subscriptions['address/transaction'][address.hashBuffer.toString('hex')] = [emitter];
      var block = {
        __height: 0,
        timestamp: new Date()
      };
      var tx = {};
      emitter.on('address/transaction', function(obj) {
        obj.address.toString().should.equal('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
        obj.tx.should.equal(tx);
        obj.timestamp.should.equal(block.timestamp);
        obj.height.should.equal(block.__height);
        obj.outputIndexes.should.deep.equal([1]);
        done();
      });
      am.transactionEventHandler({
        addressInfo: {
          hashHex: address.hashBuffer.toString('hex'),
          hashBuffer: address.hashBuffer,
          addressType: address.type
        },
        height: block.__height,
        timestamp: block.timestamp,
        outputIndexes: [1],
        tx: tx
      });
    });
  });

  describe('#balanceEventHandler', function() {
    it('will emit a balance if there is a subscriber', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      am.subscriptions['address/balance'][address.hashBuffer.toString('hex')] = [emitter];
      var block = {};
      var balance = 1000;
      am.getBalance = sinon.stub().callsArgWith(2, null, balance);
      emitter.on('address/balance', function(a, bal, b) {
        a.toString().should.equal('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
        bal.should.equal(balance);
        b.should.equal(block);
        done();
      });
      am.balanceEventHandler(block, {
        hashHex: address.hashBuffer.toString('hex'),
        hashBuffer: address.hashBuffer,
        addressType: address.type
      });
    });
  });

  describe('#subscribe', function() {
    it('will add emitters to the subscribers array (transaction)', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();

      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      var name = 'address/transaction';
      am.subscribe(name, emitter, [address]);
      am.subscriptions['address/transaction'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter]);

      var address2 = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W');
      am.subscribe(name, emitter, [address2]);
      am.subscriptions['address/transaction'][address2.hashBuffer.toString('hex')]
        .should.deep.equal([emitter]);

      var emitter2 = new EventEmitter();
      am.subscribe(name, emitter2, [address]);
      am.subscriptions['address/transaction'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter, emitter2]);
    });
    it('will add an emitter to the subscribers array (balance)', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var name = 'address/balance';
      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      am.subscribe(name, emitter, [address]);
      am.subscriptions['address/balance'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter]);

      var address2 = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W');
      am.subscribe(name, emitter, [address2]);
      am.subscriptions['address/balance'][address2.hashBuffer.toString('hex')]
        .should.deep.equal([emitter]);

      var emitter2 = new EventEmitter();
      am.subscribe(name, emitter2, [address]);
      am.subscriptions['address/balance'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter, emitter2]);
    });
  });

  describe('#unsubscribe', function() {
    it('will remove emitter from subscribers array (transaction)', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var emitter2 = new EventEmitter();
      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      am.subscriptions['address/transaction'][address.hashBuffer.toString('hex')] = [emitter, emitter2];
      var name = 'address/transaction';
      am.unsubscribe(name, emitter, [address]);
      am.subscriptions['address/transaction'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter2]);
    });
    it('will remove emitter from subscribers array (balance)', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var emitter2 = new EventEmitter();
      var address = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      var name = 'address/balance';
      am.subscriptions['address/balance'][address.hashBuffer.toString('hex')] = [emitter, emitter2];
      am.unsubscribe(name, emitter, [address]);
      am.subscriptions['address/balance'][address.hashBuffer.toString('hex')]
        .should.deep.equal([emitter2]);
    });
    it('should unsubscribe from all addresses if no addresses are specified', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var emitter = new EventEmitter();
      var emitter2 = new EventEmitter();
      var address1 = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W');
      var hashHex1 = address1.hashBuffer.toString('hex');
      var address2 = bitcore.Address('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
      var hashHex2 = address2.hashBuffer.toString('hex');
      am.subscriptions['address/balance'][hashHex1] = [emitter, emitter2];
      am.subscriptions['address/balance'][hashHex2] = [emitter2, emitter];
      am.unsubscribe('address/balance', emitter);
      am.subscriptions['address/balance'][hashHex1].should.deep.equal([emitter2]);
      am.subscriptions['address/balance'][hashHex2].should.deep.equal([emitter2]);
    });
  });

  describe('#getBalance', function() {
    it('should sum up the unspent outputs', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      var outputs = [
        {satoshis: 1000}, {satoshis: 2000}, {satoshis: 3000}
      ];
      am.getUnspentOutputs = sinon.stub().callsArgWith(2, null, outputs);
      am.getBalance('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N', false, function(err, balance) {
        should.not.exist(err);
        balance.should.equal(6000);
        done();
      });
    });

    it('will handle error from unspent outputs', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.getUnspentOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getBalance('someaddress', false, function(err) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });

  });

  describe('#createInputsStream', function() {
    it('transform stream from buffer into object', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            tip: {
              __height: 157
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      addressService.createInputsDBStream = sinon.stub().returns(streamStub);
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createInputsStream(address, {});
      testStream.once('data', function(data) {
        data.address.should.equal('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W');
        data.hashType.should.equal('pubkeyhash');
        data.txid.should.equal('7b94e3c39386845ea383b8e726b20b5172ccd3ef9be008bbb133e3b63f07df72');
        data.inputIndex.should.equal(1);
        data.height.should.equal(157);
        data.confirmations.should.equal(1);
        done();
      });
      streamStub.emit('data', {
        key: new Buffer('030b2f0a0c31bfe0406b0ccc1381fdbe311946dadc01000000009d786cfeae288d74aaf9f51f215f9882e7bd7bc18af7a550683c4d7c6962f6372900000004', 'hex'),
        value: new Buffer('7b94e3c39386845ea383b8e726b20b5172ccd3ef9be008bbb133e3b63f07df7200000001', 'hex')
      });
      streamStub.emit('end');
    });
  });

  describe('#createInputsDBStream', function() {
    it('will stream all keys', function() {
      var streamStub = sinon.stub().returns({});
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            store: {
              createReadStream: streamStub
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var options = {};
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createInputsDBStream(address, options);
      should.exist(testStream);
      streamStub.callCount.should.equal(1);
      var expectedGt = '03038a213afdfc551fc658e9a2a58a86e98d69b687010000000000';
      // The expected "lt" value should be one value above the start value, due
      // to the keys having additional data following it and can't be "equal".
      var expectedLt = '03038a213afdfc551fc658e9a2a58a86e98d69b68701ffffffffff';
      streamStub.args[0][0].gt.toString('hex').should.equal(expectedGt);
      streamStub.args[0][0].lt.toString('hex').should.equal(expectedLt);
    });
    it('will stream keys based on a range of block heights', function() {
      var streamStub = sinon.stub().returns({});
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            store: {
              createReadStream: streamStub
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var options = {
        start: 1,
        end: 0
      };
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createInputsDBStream(address, options);
      should.exist(testStream);
      streamStub.callCount.should.equal(1);
      var expectedGt = '03038a213afdfc551fc658e9a2a58a86e98d69b687010000000000';
      // The expected "lt" value should be one value above the start value, due
      // to the keys having additional data following it and can't be "equal".
      var expectedLt = '03038a213afdfc551fc658e9a2a58a86e98d69b687010000000002';
      streamStub.args[0][0].gt.toString('hex').should.equal(expectedGt);
      streamStub.args[0][0].lt.toString('hex').should.equal(expectedLt);
    });
  });

  describe('#getInputs', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address(address).hashBuffer;
    var hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
      network: Networks.livenet,
      datadir: 'testdir',
      services: {
        db: db,
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
    });

    it('will add mempool inputs on close', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var db = {
        store: {
          createReadStream: sinon.stub().returns(testStream)
        },
        tip: {
          __height: 10
        }
      };
      var testnode = {
        network: Networks.livenet,
        datadir: 'testdir',
        services: {
          db: db,
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      am._getInputsMempool = sinon.stub().callsArgWith(3, null, {
        address: address,
        hashType: 'pubkeyhash',
        height: -1,
        confirmations: 0
      });
      am.getInputs(address, args, function(err, inputs) {
        should.not.exist(err);
        inputs.length.should.equal(1);
        inputs[0].address.should.equal(address);
        inputs[0].height.should.equal(-1);
        done();
      });
      testStream.push(null);
    });
    it('will get inputs for an address and timestamp', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gt = Buffer.concat([constants.PREFIXES.SPENTS, hashBuffer,
                                   hashTypeBuffer, new Buffer('000000000c', 'hex')]);
          ops.gt.toString('hex').should.equal(gt.toString('hex'));
          var lt = Buffer.concat([constants.PREFIXES.SPENTS, hashBuffer,
                                   hashTypeBuffer, new Buffer('0000000010', 'hex')]);
          ops.lt.toString('hex').should.equal(lt.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am.node.services.bitcoind = {
        getMempoolInputs: sinon.stub().returns([])
      };
      am._getInputsMempool = sinon.stub().callsArgWith(3, null, []);
      am.getInputs(address, args, function(err, inputs) {
        should.not.exist(err);
        inputs.length.should.equal(1);
        inputs[0].address.should.equal(address);
        inputs[0].txid.should.equal('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7');
        inputs[0].inputIndex.should.equal(0);
        inputs[0].height.should.equal(15);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      var data = {
        key: new Buffer('33038a213afdfc551fc658e9a2a58a86e98d69b68701000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000000', 'hex')
      };
      testStream.emit('data', data);
      testStream.push(null);
    });
    it('should get inputs for address', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var args = {
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gt = Buffer.concat([constants.PREFIXES.SPENTS, hashBuffer, hashTypeBuffer, new Buffer('0000000000', 'hex')]);
          ops.gt.toString('hex').should.equal(gt.toString('hex'));
          var lt = Buffer.concat([constants.PREFIXES.SPENTS, hashBuffer, hashTypeBuffer, new Buffer('ffffffffff', 'hex')]);
          ops.lt.toString('hex').should.equal(lt.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am.node.services.bitcoind = {
        getMempoolInputs: sinon.stub().returns([])
      };
      am.getInputs(address, args, function(err, inputs) {
        should.not.exist(err);
        inputs.length.should.equal(1);
        inputs[0].address.should.equal(address);
        inputs[0].txid.should.equal('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7');
        inputs[0].inputIndex.should.equal(0);
        inputs[0].height.should.equal(15);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      var data = {
        key: new Buffer('33038a213afdfc551fc658e9a2a58a86e98d69b68701000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000000', 'hex')
      };
      testStream.emit('data', data);
      testStream.push(null);
    });
    it('should give an error if the readstream has an error', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(testStream)
      };

      am.getInputs(address, {}, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });

      testStream.emit('error', new Error('readstreamerror'));
      setImmediate(function() {
        testStream.push(null);
      });
    });

  });

  describe('#_getInputsMempool', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address(address).hashBuffer;
    var hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
      network: Networks.testnet,
      datadir: 'testdir',
      services: {
        db: db,
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
    });
    it('it will handle error', function(done) {
      var testStream = new EventEmitter();
      am.mempoolIndex = {};
      am.mempoolIndex.createReadStream = sinon.stub().returns(testStream);

      am._getInputsMempool(address, hashBuffer, hashTypeBuffer, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });

      testStream.emit('error', new Error('readstreamerror'));
      setImmediate(function() {
        testStream.emit('close');
      });
    });
    it('it will parse data', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      am.mempoolIndex = {};
      am.mempoolIndex.createReadStream = sinon.stub().returns(testStream);

      var nowTime = new Date().getTime();

      am._getInputsMempool(address, hashBuffer, hashTypeBuffer, function(err, inputs) {
        should.not.exist(err);
        inputs.length.should.equal(1);
        var input = inputs[0];
        input.address.should.equal(address);
        input.txid.should.equal(txid);
        input.hashType.should.equal('pubkeyhash');
        input.hashType.should.equal(constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')]);
        input.inputIndex.should.equal(5);
        input.height.should.equal(-1);
        input.confirmations.should.equal(0);
        input.timestamp.should.equal(nowTime);
        done();
      });

      var txid = '5d32f0fff6871c377e00c16f48ebb5e89c723d0b9dd25f68fdda70c3392bee61';
      var inputIndex = 5;
      var inputIndexBuffer = new Buffer(4);
      var timestampBuffer = new Buffer(new Array(8));
      timestampBuffer.writeDoubleBE(nowTime);
      inputIndexBuffer.writeUInt32BE(inputIndex);
      var valueData = Buffer.concat([
        new Buffer(txid, 'hex'),
        inputIndexBuffer,
        timestampBuffer
      ]);
      // Note: key is not used currently
      testStream.emit('data', {
        value: valueData
      });
      testStream.emit('close');
    });
  });

  describe('#_getSpentMempool', function() {
    it('will decode data from the database', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.mempoolIndex = {};
      var mempoolValue = Buffer.concat([
        new Buffer('85630d684f1f414264f88a31bddfc79dd0c00659330dcdc393b321c121f4078b', 'hex'),
        new Buffer('00000003', 'hex')
      ]);
      am.mempoolIndex.get = sinon.stub().callsArgWith(1, null, mempoolValue);
      var prevTxIdBuffer = new Buffer('e7888264d286be2da26b0a4dbd2fc5c9ece82b3e40e6791b137e4155b6da8981', 'hex');
      var outputIndex = 1;
      var outputIndexBuffer = new Buffer('00000001', 'hex');
      var expectedKey = Buffer.concat([
        new Buffer('03', 'hex'),
        prevTxIdBuffer,
        outputIndexBuffer
      ]).toString('hex');
      am._getSpentMempool(prevTxIdBuffer, outputIndex, function(err, value) {
        if (err) {
          throw err;
        }
        am.mempoolIndex.get.args[0][0].toString('hex').should.equal(expectedKey);
        value.inputTxId.should.equal('85630d684f1f414264f88a31bddfc79dd0c00659330dcdc393b321c121f4078b');
        value.inputIndex.should.equal(3);
      });
    });
    it('handle error from levelup', function() {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.mempoolIndex = {};
      am.mempoolIndex.get = sinon.stub().callsArgWith(1, new Error('test'));
      var prevTxIdBuffer = new Buffer('e7888264d286be2da26b0a4dbd2fc5c9ece82b3e40e6791b137e4155b6da8981', 'hex');
      var outputIndex = 1;
      am._getSpentMempool(prevTxIdBuffer, outputIndex, function(err) {
        err.message.should.equal('test');
      });
    });
  });

  describe('#createOutputsStream', function() {
    it('transform stream from buffer into object', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            tip: {
              __height: 157
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      addressService.createOutputsDBStream = sinon.stub().returns(streamStub);
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createOutputsStream(address, {});
      testStream.once('data', function(data) {
        data.address.should.equal('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W');
        data.hashType.should.equal('pubkeyhash');
        data.txid.should.equal('4078b72b09391f5146e2c564f5847d49b179f9946b253f780f65b140d46ef6f9');
        data.outputIndex.should.equal(2);
        data.height.should.equal(157);
        data.satoshis.should.equal(10000);
        data.script.toString('hex').should.equal('76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac');
        data.confirmations.should.equal(1);
        done();
      });
      streamStub.emit('data', {
        key: new Buffer('020b2f0a0c31bfe0406b0ccc1381fdbe311946dadc01000000009d4078b72b09391f5146e2c564f5847d49b179f9946b253f780f65b140d46ef6f900000002', 'hex'),
        value: new Buffer('40c388000000000076a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac', 'hex')
      });
      streamStub.emit('end');
    });
  });

  describe('#createOutputsDBStream', function() {
    it('will stream all keys', function() {
      var streamStub = sinon.stub().returns({});
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            store: {
              createReadStream: streamStub
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var options = {};
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createOutputsDBStream(address, options);
      should.exist(testStream);
      streamStub.callCount.should.equal(1);
      var expectedGt = '02038a213afdfc551fc658e9a2a58a86e98d69b687010000000000';
      // The expected "lt" value should be one value above the start value, due
      // to the keys having additional data following it and can't be "equal".
      var expectedLt = '02038a213afdfc551fc658e9a2a58a86e98d69b68701ffffffffff';
      streamStub.args[0][0].gt.toString('hex').should.equal(expectedGt);
      streamStub.args[0][0].lt.toString('hex').should.equal(expectedLt);
    });
    it('will stream keys based on a range of block heights', function() {
      var streamStub = sinon.stub().returns({});
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            store: {
              createReadStream: streamStub
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var options = {
        start: 1,
        end: 0
      };
      var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      var testStream = addressService.createOutputsDBStream(address, options);
      should.exist(testStream);
      streamStub.callCount.should.equal(1);
      var expectedGt = '02038a213afdfc551fc658e9a2a58a86e98d69b687010000000000';
      // The expected "lt" value should be one value above the start value, due
      // to the keys having additional data following it and can't be "equal".
      var expectedLt = '02038a213afdfc551fc658e9a2a58a86e98d69b687010000000002';
      streamStub.args[0][0].gt.toString('hex').should.equal(expectedGt);
      streamStub.args[0][0].lt.toString('hex').should.equal(expectedLt);
    });
  });

  describe('#getOutputs', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W').hashBuffer;
    var hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
      network: Networks.livenet,
      datadir: 'testdir',
      services: {
        db: db,
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    var options = {
      queryMempool: true
    };

    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
    });

    it('will get outputs for an address and timestamp', function(done) {
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('000000000c', 'hex')]);
          ops.gt.toString('hex').should.equal(gt.toString('hex'));
          var lt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('0000000010', 'hex')]);
          ops.lt.toString('hex').should.equal(lt.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am._getOutputsMempool = sinon.stub().callsArgWith(3, null, []);
      am.getOutputs(address, args, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(1);
        outputs[0].address.should.equal(address);
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].hashType.should.equal('pubkeyhash');
        outputs[0].hashType.should.equal(constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')]);
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[0].height.should.equal(15);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      var data = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b68701000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('41f0de058a80000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };
      testStream.emit('data', data);
      testStream.push(null);
    });

    it('should get outputs for an address', function(done) {
      var readStream1 = new stream.Readable();
      readStream1._read = function() { /* do nothing */ };
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(readStream1)
      };

      am._getOutputsMempool = sinon.stub().callsArgWith(3, null, [
        {
          address: address,
          height: -1,
          hashType: 'pubkeyhash',
          confirmations: 0,
          txid: 'aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371',
          satoshis: 307627737,
          script: '76a914f6db95c81dea3d10f0ff8d890927751bf7b203c188ac',
          outputIndex: 0
        }
      ]);

      am.getOutputs(address, options, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(3);
        outputs[0].address.should.equal(address);
        outputs[0].hashType.should.equal('pubkeyhash');
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[0].height.should.equal(345000);
        outputs[1].address.should.equal(address);
        outputs[1].hashType.should.equal('pubkeyhash');
        outputs[1].txid.should.equal('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7');
        outputs[1].outputIndex.should.equal(2);
        outputs[1].satoshis.should.equal(10000);
        outputs[1].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[1].height.should.equal(345004);
        outputs[2].address.should.equal(address);
        outputs[2].hashType.should.equal('pubkeyhash');
        outputs[2].txid.should.equal('aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371');
        outputs[2].script.should.equal('76a914f6db95c81dea3d10f0ff8d890927751bf7b203c188ac');
        outputs[2].height.should.equal(-1);
        outputs[2].confirmations.should.equal(0);
        done();
      });

      var data1 = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b6870100000543a8125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('41f0de058a80000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };

      var data2 = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b6870100000543ac3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000002', 'hex'),
        value: new Buffer('40c388000000000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };

      readStream1.emit('data', data1);
      readStream1.emit('data', data2);
      readStream1.push(null);
    });

    it('should give an error if the readstream has an error', function(done) {
      var readStream2 = new stream.Readable();
      readStream2._read = function() { /* do nothing */ };
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(readStream2)
      };

      am.getOutputs(address, options, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });

      readStream2.emit('error', new Error('readstreamerror'));
      setImmediate(function() {
        readStream2.push(null);
      });
    });

    it('should print outputs for a p2sh address', function(done) {
      // This address has the redeemScript 0x038a213afdfc551fc658e9a2a58a86e98d69b687,
      // which is the same as the pkhash for the address 1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W.
      // See https://github.com/bitpay/bitcore-node/issues/377
      var address = '321jRYeWBrLBWr2j1KYnAFGico3GUdd5q7';
      var hashBuffer = bitcore.Address(address).hashBuffer;
      var hashTypeBuffer = constants.HASH_TYPES.REDEEMSCRIPT;
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('000000000c', 'hex')]);
          ops.gt.toString('hex').should.equal(gt.toString('hex'));
          var lt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('0000000010', 'hex')]);
          ops.lt.toString('hex').should.equal(lt.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am._getOutputsMempool = sinon.stub().callsArgWith(3, null, []);
      am.getOutputs(address, args, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(1);
        outputs[0].address.should.equal(address);
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].hashType.should.equal('scripthash');
        outputs[0].hashType.should.equal(constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')]);
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('a914038a213afdfc551fc658e9a2a58a86e98d69b68787');
        outputs[0].height.should.equal(15);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      var data = {
        // note '68702', '02' meaning p2sh redeemScript, not p2pkh
        // value is also the p2sh script, not p2pkh
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b68702000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('41f0de058a800000a914038a213afdfc551fc658e9a2a58a86e98d69b68787', 'hex')
      };
      testStream.emit('data', data);
      testStream.push(null);
    });

    it('should not print outputs for a p2pkh address, if the output was sent to a p2sh redeemScript', function(done) {
      // This address has the redeemScript 0x038a213afdfc551fc658e9a2a58a86e98d69b687,
      // which is the same as the pkhash for the address 1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W.
      // See https://github.com/bitpay/bitcore-node/issues/377
      var address = '321jRYeWBrLBWr2j1KYnAFGico3GUdd5q7';
      var hashBuffer = bitcore.Address(address).hashBuffer;
      var hashTypeBuffer = constants.HASH_TYPES.REDEEMSCRIPT;
      var testStream = new stream.Readable();
      testStream._read = function() { /* do nothing */ };
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;

      // Verifying that the db query is looking for a redeemScript, *not* a p2pkh
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('000000000c', 'hex')]);
          ops.gt.toString('hex').should.equal(gt.toString('hex'));
          var lt = Buffer.concat([constants.PREFIXES.OUTPUTS, hashBuffer, hashTypeBuffer, new Buffer('0000000010', 'hex')]);
          ops.lt.toString('hex').should.equal(lt.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am._getOutputsMempool = sinon.stub().callsArgWith(3, null, []);
      am.getOutputs(address, args, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(0);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      testStream.push(null);
    });
  });

  describe('#_getOutputsMempool', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address(address).hashBuffer;
    var hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
      network: Networks.testnet,
      datadir: 'testdir',
      services: {
        db: db,
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
    });
    it('it will handle error', function(done) {
      var testStream = new EventEmitter();
      am.mempoolIndex = {};
      am.mempoolIndex.createReadStream = sinon.stub().returns(testStream);
      am._getOutputsMempool(address, hashBuffer, hashTypeBuffer, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });
      testStream.emit('error', new Error('readstreamerror'));
      setImmediate(function() {
        testStream.emit('close');
      });
    });
    it('it will parse data', function(done) {
      var testStream = new EventEmitter();
      am.mempoolIndex = {};
      am.mempoolIndex.createReadStream = sinon.stub().returns(testStream);

      am._getOutputsMempool(address, hashBuffer, hashTypeBuffer, function(err, outputs) {
        if (err) {
          throw err;
        }
        outputs.length.should.equal(1);
        var output = outputs[0];
        output.address.should.equal(address);
        output.hashType.should.equal('pubkeyhash');
        output.txid.should.equal(txid);
        output.outputIndex.should.equal(outputIndex);
        output.height.should.equal(-1);
        output.satoshis.should.equal(3);
        output.script.should.equal('ac');
        output.timestamp.should.equal(1452696715750);
        output.confirmations.should.equal(0);
        done();
      });

      var txid = '5d32f0fff6871c377e00c16f48ebb5e89c723d0b9dd25f68fdda70c3392bee61';
      var txidBuffer = new Buffer(txid, 'hex');
      var outputIndex = 3;
      var outputIndexBuffer = new Buffer(4);
      outputIndexBuffer.writeUInt32BE(outputIndex);
      var keyData = Buffer.concat([
        constants.MEMPREFIXES.OUTPUTS,
        hashBuffer,
        hashTypeBuffer,
        txidBuffer,
        outputIndexBuffer
      ]);

      var valueData = Buffer.concat([
        new Buffer('4008000000000000', 'hex'),
        new Buffer('427523b78c1e6000', 'hex'),
        new Buffer('ac', 'hex')
      ]);

      // Note: key is not used currently
      testStream.emit('data', {
        key: keyData,
        value: valueData
      });
      setImmediate(function() {
        testStream.emit('close');
      });
    });
  });

  describe('#getUnspentOutputs', function() {
    it('should concatenate utxos for multiple addresses, even those with none found', function(done) {
      var addresses = {
        'addr1': ['utxo1', 'utxo2'],
        'addr2': new errors.NoOutputs(),
        'addr3': ['utxo3']
      };

      var db = {};
      var testnode = {
        network: Networks.testnet,
        datadir: 'testdir',
        services: {
          db: db,
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.getUnspentOutputsForAddress = function(address, queryMempool, callback) {
        var result = addresses[address];
        if(result instanceof Error) {
          return callback(result);
        } else {
          return callback(null, result);
        }
      };

      am.getUnspentOutputs(['addr1', 'addr2', 'addr3'], true, function(err, utxos) {
        should.not.exist(err);
        utxos.should.deep.equal(['utxo1', 'utxo2', 'utxo3']);
        done();
      });
    });
    it('should give an error if an error occurred', function(done) {
      var addresses = {
        'addr1': ['utxo1', 'utxo2'],
        'addr2': new Error('weird error'),
        'addr3': ['utxo3']
      };

      var db = {};
      var testnode = {
        network: Networks.testnet,
        datadir: 'testdir',
        db: db,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.getUnspentOutputsForAddress = function(address, queryMempool, callback) {
        var result = addresses[address];
        if(result instanceof Error) {
          return callback(result);
        } else {
          return callback(null, result);
        }
      };

      am.getUnspentOutputs(['addr1', 'addr2', 'addr3'], true, function(err, utxos) {
        should.exist(err);
        err.message.should.equal('weird error');
        done();
      });
    });

    it('should also work for a single address', function(done) {
      var addresses = {
        'addr1': ['utxo1', 'utxo2'],
        'addr2': new Error('weird error'),
        'addr3': ['utxo3']
      };

      var db = {};
      var testnode = {
        network: Networks.testnet,
        datadir: 'testdir',
        db: db,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.getUnspentOutputsForAddress = function(address, queryMempool, callback) {
        var result = addresses[address];
        if(result instanceof Error) {
          return callback(result);
        } else {
          return callback(null, result);
        }
      };

      am.getUnspentOutputs('addr1', true, function(err, utxos) {
        should.not.exist(err);
        utxos.should.deep.equal(['utxo1', 'utxo2']);
        done();
      });
    });
  });

  describe('#getUnspentOutputsForAddress', function() {
    it('should filter out spent outputs', function(done) {
      var outputs = [
        {
          satoshis: 1000,
          spent: false,
        },
        {
          satoshis: 2000,
          spent: true
        },
        {
          satoshis: 3000,
          spent: false
        }
      ];
      var i = 0;

      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.getOutputs = sinon.stub().callsArgWith(2, null, outputs);
      am.isUnspent = function(output, options, callback) {
        callback(!outputs[i].spent);
        i++;
      };

      am.getUnspentOutputsForAddress('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(2);
        outputs[0].satoshis.should.equal(1000);
        outputs[1].satoshis.should.equal(3000);
        done();
      });
    });
    it('should handle an error from getOutputs', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.getOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getUnspentOutputsForAddress('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
    it('should handle when there are no outputs', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.getOutputs = sinon.stub().callsArgWith(2, null, []);
      am.getUnspentOutputsForAddress('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.exist(err);
        err.should.be.instanceof(errors.NoOutputs);
        outputs.length.should.equal(0);
        done();
      });
    });
  });

  describe('#isUnspent', function() {
    var am;

    before(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
    });

    it('should give true when isSpent() gives false', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, false);
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', {}, function(unspent) {
        unspent.should.equal(true);
        done();
      });
    });

    it('should give false when isSpent() gives true', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, true);
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', {},function(unspent) {
        unspent.should.equal(false);
        done();
      });
    });

    it('should give false when isSpent() returns an error', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, new Error('error'));
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', {}, function(unspent) {
        unspent.should.equal(false);
        done();
      });
    });
  });

  describe('#isSpent', function() {
    var db = {};
    var testnode = {
      network: Networks.testnet,
      datadir: 'testdir',
      db: db,
      services: {
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    it('should give true if bitcoind.isSpent gives true (with output info)', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var isSpent = sinon.stub().returns(true);
      am.node.services.bitcoind = {
        isSpent: isSpent,
        on: sinon.stub()
      };
      var output = {
        txid: '4228d3f41051f914f71a1dcbbe4098e29a07cc2672fdadab0763d88ffd6ffa57',
        outputIndex: 3
      };
      am.isSpent(output, {}, function(spent) {
        isSpent.callCount.should.equal(1);
        isSpent.args[0][0].should.equal(output.txid);
        isSpent.args[0][1].should.equal(output.outputIndex);
        spent.should.equal(true);
        done();
      });
    });
    it('should give true if bitcoind.isSpent gives true (with input)', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var isSpent = sinon.stub().returns(true);
      am.node.services.bitcoind = {
        isSpent: isSpent,
        on: sinon.stub()
      };
      var txid = '4228d3f41051f914f71a1dcbbe4098e29a07cc2672fdadab0763d88ffd6ffa57';
      var output = {
        prevTxId: new Buffer(txid, 'hex'),
        outputIndex: 4
      };
      am.isSpent(output, {}, function(spent) {
        isSpent.callCount.should.equal(1);
        isSpent.args[0][0].should.equal(txid);
        isSpent.args[0][1].should.equal(output.outputIndex);
        spent.should.equal(true);
        done();
      });
    });
    it('should give true if bitcoind.isSpent is false and mempoolSpentIndex is true', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.node.services.bitcoind = {
        isSpent: sinon.stub().returns(false),
        on: sinon.stub()
      };
      var txid = '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7';
      var outputIndex = 0;
      var output = {
        prevTxId: new Buffer(txid, 'hex'),
        outputIndex: outputIndex
      };
      var outputIndexBuffer = new Buffer(4);
      outputIndexBuffer.writeUInt32BE(outputIndex);
      var spentKey = Buffer.concat([
        new Buffer(txid, 'hex'),
        outputIndexBuffer
      ]).toString('binary');
      am.mempoolSpentIndex[spentKey] = true;
      am.isSpent(output, {queryMempool: true}, function(spent) {
        spent.should.equal(true);
        done();
      });
    });
    it('should give false if spent in mempool with queryMempool set to false', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.node.services.bitcoind = {
        isSpent: sinon.stub().returns(false),
        on: sinon.stub()
      };
      var txid = '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7';
      var outputIndex = 0;
      var output = {
        prevTxId: new Buffer(txid, 'hex'),
        outputIndex: outputIndex
      };
      var spentKey = [txid, outputIndex].join('-');
      am.mempoolSpentIndex[spentKey] = new Buffer(5);
      am.isSpent(output, {queryMempool: false}, function(spent) {
        spent.should.equal(false);
        done();
      });
    });
    it('default to querying the mempool', function(done) {
      var am = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      am.node.services.bitcoind = {
        isSpent: sinon.stub().returns(false),
        on: sinon.stub()
      };
      var txidBuffer = new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', 'hex');
      var outputIndex = 0;
      var output = {
        prevTxId: txidBuffer,
        outputIndex: outputIndex
      };
      var outputIndexBuffer = new Buffer(4);
      outputIndexBuffer.writeUInt32BE(outputIndex);
      var spentKey = Buffer.concat([
        txidBuffer,
        outputIndexBuffer
      ]).toString('binary');
      am.mempoolSpentIndex[spentKey] = true;
      am.isSpent(output, {}, function(spent) {
        spent.should.equal(true);
        done();
      });
    });
  });

  describe('#getAddressHistory', function() {
    it('will call get on address history instance', function(done) {
      function TestAddressHistory(args) {
        args.node.should.equal(mocknode);
        args.addresses.should.deep.equal([]);
        args.options.should.deep.equal({});
      }
      TestAddressHistory.prototype.get = sinon.stub().callsArg(0);
      var TestAddressService = proxyquire('../../../lib/services/address', {
        './history': TestAddressHistory
      });
      var am = new TestAddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      am.getAddressHistory([], {}, function(err, history) {
        TestAddressHistory.prototype.get.callCount.should.equal(1);
        done();
      });
    });
  });
  describe('#updateMempoolIndex/#removeMempoolIndex', function() {
    var am;
    var tx = Transaction().fromBuffer(txBuf);
    var clock;

    beforeEach(function() {
      am = new AddressService({
        mempoolMemoryIndex: true,
        node: mocknode
      });
      clock = sinon.useFakeTimers();
    });

    afterEach(function() {
      clock.restore();
    });

    it('will update the input and output indexes', function() {
      am.mempoolIndex = {};
      am.mempoolIndex.batch = function(operations, callback) {
        callback.should.be.a('function');
        Object.keys(am.mempoolSpentIndex).length.should.equal(14);
        for (var i = 0; i < operations.length; i++) {
          operations[i].type.should.equal('put');
        }
        var nowTime = new Date().getTime();
        var nowTimeBuffer = new Buffer(8);
        nowTimeBuffer.writeDoubleBE(nowTime);
        var expectedValue = '45202ffdeb8344af4dec07cddf0478485dc65cc7d08303e45959630c89b51ea200000002' +
          nowTimeBuffer.toString('hex');
        operations[7].value.toString('hex').should.equal(expectedValue);
        var matches = 0;


        for (var j = 0; j < operations.length; j++) {
          var match = Buffer.concat([
            constants.MEMPREFIXES.SPENTS,
            bitcore.Address('1JT7KDYwT9JY9o2vyqcKNSJgTWeKfV3ui8').hashBuffer
          ]).toString('hex');

          if (operations[j].key.slice(0, 21).toString('hex') === match) {
            matches++;
          }
        }
        matches.should.equal(12);
      };
      am.updateMempoolIndex(tx, true);
    });

    it('will remove the input and output indexes', function() {
      am.mempoolIndex = {};
      am.mempoolIndex.batch = function(operations, callback) {
        callback.should.be.a('function');
        Object.keys(am.mempoolSpentIndex).length.should.equal(0);
        for (var i = 0; i < operations.length; i++) {
          operations[i].type.should.equal('del');
        }
      };
      am.updateMempoolIndex(tx, false);
    });

  });

  describe('#getAddressSummary', function() {
    var clock;
    beforeEach(function() {
      clock = sinon.useFakeTimers();
      sinon.stub(log, 'warn');
    });
    afterEach(function() {
      clock.restore();
      log.warn.restore();
    });
    it('will handle error from _getAddressConfirmedSummary', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      addressService._getAddressConfirmedSummary = sinon.stub().callsArgWith(2, new Error('test'));
      addressService.getAddressSummary(address, options, function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });
    it('will handle error from _getAddressMempoolSummary', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      addressService._getAddressConfirmedSummary = sinon.stub().callsArg(2);
      addressService._getAddressMempoolSummary = sinon.stub().callsArgWith(2, new Error('test2'));
      addressService.getAddressSummary(address, options, function(err) {
        should.exist(err);
        err.message.should.equal('test2');
        done();
      });
    });
    it('will pass cache and summary between functions correctly', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      var cache = {};
      var summary = {};
      addressService._getAddressConfirmedSummary = sinon.stub().callsArgWith(2, null, cache);
      addressService._getAddressMempoolSummary = sinon.stub().callsArgWith(3, null, cache);
      addressService._transformAddressSummaryFromCache = sinon.stub().returns(summary);
      addressService.getAddressSummary(address, options, function(err, sum) {
        addressService._getAddressConfirmedSummary.callCount.should.equal(1);
        addressService._getAddressMempoolSummary.callCount.should.equal(1);
        addressService._getAddressMempoolSummary.args[0][2].should.equal(cache);
        addressService._transformAddressSummaryFromCache.callCount.should.equal(1);
        addressService._transformAddressSummaryFromCache.args[0][0].should.equal(cache);
        sum.should.equal(summary);
        done();
      });
    });
    it('will log if there is a slow query', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      var cache = {};
      var summary = {};
      addressService._getAddressConfirmedSummary = sinon.stub().callsArgWith(2, null, cache);
      addressService._getAddressConfirmedSummary = sinon.stub().callsArgWith(2, null, cache);
      addressService._getAddressMempoolSummary = sinon.stub().callsArgWith(3, null, cache);
      addressService._transformAddressSummaryFromCache = sinon.stub().returns(summary);
      addressService.getAddressSummary(address, options, function() {
        log.warn.callCount.should.equal(2);
        done();
      });
      clock.tick(6000);
    });
  });

  describe('#_getAddressConfirmedSummary', function() {
    it('handle error from _getAddressConfirmedSummaryCache', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            tip: {
              __height: 10
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      addressService._getAddressConfirmedSummaryCache = sinon.stub().callsArgWith(2, new Error('test'));
      addressService._getAddressConfirmedSummary(address, options, function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });

    it('will NOT update cache if matches current tip', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            tip: {
              __height: 10
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      var cache = {
        height: 10
      };
      addressService._updateAddressConfirmedSummaryCache = sinon.stub();
      addressService._getAddressConfirmedSummaryCache = sinon.stub().callsArgWith(2, null, cache);
      addressService._getAddressConfirmedSummary(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        should.exist(cache);
        addressService._updateAddressConfirmedSummaryCache.callCount.should.equal(0);
        done();
      });
    });

    it('will call _updateAddressConfirmedSummaryCache with correct arguments', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          },
          db: {
            tip: {
              __height: 11
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var options = {};
      var cache = {
        height: 10
      };
      addressService._updateAddressConfirmedSummaryCache = sinon.stub().callsArgWith(4, null, cache);
      addressService._getAddressConfirmedSummaryCache = sinon.stub().callsArgWith(2, null, cache);
      addressService._getAddressConfirmedSummary(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        should.exist(cache);
        addressService._updateAddressConfirmedSummaryCache.callCount.should.equal(1);
        var args = addressService._updateAddressConfirmedSummaryCache.args[0];
        args[0].should.equal(address);
        args[1].should.equal(options);
        args[2].should.equal(cache);
        args[3].should.equal(11);
        done();
      });
    });
  });

  describe('#_getAddressConfirmedSummaryCache', function() {
    function shouldExistBasecache(cache) {
      should.exist(cache);
      should.not.exist(cache.height);
      should.exist(cache.result);
      cache.result.appearanceIds.should.deep.equal({});
      cache.result.totalReceived.should.equal(0);
      cache.result.balance.should.equal(0);
      cache.result.unconfirmedAppearanceIds.should.deep.equal({});
      cache.result.unconfirmedBalance.should.equal(0);
    }
    it('give base cache if "start" or "end" options are used (e.g. >= 0)', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {
        start: 0,
        end: 0
      };
      addressService._getAddressConfirmedSummaryCache(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        shouldExistBasecache(cache);
        done();
      });
    });
    it('give base cache if "start" or "end" options are used (e.g. 10, 9)', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {
        start: 10,
        end: 9
      };
      addressService._getAddressConfirmedSummaryCache(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        shouldExistBasecache(cache);
        done();
      });
    });

    it('give base cache if cache does NOT exist', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {};
      addressService.summaryCache = {};
      addressService.summaryCache.get = sinon.stub().callsArgWith(2, new levelup.errors.NotFoundError());
      addressService._getAddressConfirmedSummaryCache(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        shouldExistBasecache(cache);
        done();
      });
    });

    it('give base cache if cached tip hash differs (e.g. reorg)', function(done) {
      var hash = '000000002c05cc2e78923c34df87fd108b22221ac6076c18f3ade378a4d915e9';
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
            getBlockIndex: sinon.stub().returns({
              hash: '00000000700e92a916b46b8b91a14d1303d5d91ef0b09eecc3151fb958fd9a2e'
            })
          },
          db: {
            tip: {
              hash: hash
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var txid = '5464b1c3f25160f0183fad68a406838d2d1ac0aee05990072ece49326c26c22e';
      var options = {};
      var cache = {
        height: 10,
        hash: hash,
        result: {
          totalReceived: 100,
          balance: 10,
          txids: [txid],
          appearanceIds: {
            '5464b1c3f25160f0183fad68a406838d2d1ac0aee05990072ece49326c26c22e': 9
          }
        }
      };
      var cacheBuffer = encoding.encodeSummaryCacheValue(cache, 10, hash);
      addressService.summaryCache = {};
      addressService.summaryCache.get = sinon.stub().callsArgWith(2, null, cacheBuffer);
      addressService._getAddressConfirmedSummaryCache(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        shouldExistBasecache(cache);
        done();
      });
    });

    it('handle error from levelup', function(done) {
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {};
      addressService.summaryCache = {};
      addressService.summaryCache.get = sinon.stub().callsArgWith(2, new Error('test'));
      addressService._getAddressConfirmedSummaryCache(address, options, function(err) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });
    });

    it('call encode and decode with args and result', function(done) {
      var hash = '000000002c05cc2e78923c34df87fd108b22221ac6076c18f3ade378a4d915e9';
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
            getBlockIndex: sinon.stub().returns({
              hash: hash
            })
          },
          db: {
            tip: {
              hash: hash
            }
          }
        },
        datadir: 'testdir'
      };
      var addressService = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var txid = '5464b1c3f25160f0183fad68a406838d2d1ac0aee05990072ece49326c26c22e';
      var options = {};
      var cache = {
        height: 10,
        hash: hash,
        result: {
          totalReceived: 100,
          balance: 10,
          txids: [txid],
          appearanceIds: {
            '5464b1c3f25160f0183fad68a406838d2d1ac0aee05990072ece49326c26c22e': 9
          }
        }
      };
      var cacheBuffer = encoding.encodeSummaryCacheValue(cache, 10, hash);
      addressService.summaryCache = {};
      addressService.summaryCache.get = sinon.stub().callsArgWith(2, null, cacheBuffer);
      addressService._getAddressConfirmedSummaryCache(address, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        should.exist(cache);
        cache.height.should.equal(10);
        cache.hash.should.equal(hash);
        should.exist(cache.result);
        cache.result.totalReceived.should.equal(100);
        cache.result.balance.should.equal(10);
        cache.result.txids.should.deep.equal([txid]);
        cache.result.appearanceIds.should.deep.equal({
          '5464b1c3f25160f0183fad68a406838d2d1ac0aee05990072ece49326c26c22e': 9
        });
        done();
      });
    });
  });

  describe('#_updateAddressConfirmedSummaryCache', function() {
    it('will pass partial options to input/output summary query', function(done) {
      var tipHeight = 12;
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {};
      var cache = {
        height: 10,
        result: {
          txids: []
        }
      };
      as._getAddressConfirmedInputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._getAddressConfirmedOutputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._setAndSortTxidsFromAppearanceIds = sinon.stub().callsArgWith(1, null, cache);
      as._saveAddressConfirmedSummaryCache = sinon.stub().callsArg(3, null, cache);
      as._updateAddressConfirmedSummaryCache(address, options, cache, tipHeight, function(err, cache) {
        if (err) {
          return done(err);
        }
        as._getAddressConfirmedInputsSummary.callCount.should.equal(1);
        as._getAddressConfirmedOutputsSummary.callCount.should.equal(1);

        as._getAddressConfirmedInputsSummary.args[0][2].start.should.equal(12);
        as._getAddressConfirmedInputsSummary.args[0][2].end.should.equal(11);

        as._getAddressConfirmedOutputsSummary.args[0][2].start.should.equal(12);
        as._getAddressConfirmedOutputsSummary.args[0][2].end.should.equal(11);
        done();
      });
    });

    it('will save cache if exceeds threshold and is NOT height query', function(done) {
      var tipHeight = 12;
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {};
      var cache = {
        height: 10,
        result: {
          txids: [
            '9a816264c50910cbf57aa4637dde5f7fec03df642b822661e8bc9710475986b6',
            '05c6b9ccf3fc4026391bf8f8a64b4784a95b930851359b8f85a4be7bb6bf6f1e'
          ]
        }
      };
      as.summaryCacheThreshold = 1;
      as._getAddressConfirmedInputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._getAddressConfirmedOutputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._setAndSortTxidsFromAppearanceIds = sinon.stub().callsArgWith(1, null, cache);
      as._saveAddressConfirmedSummaryCache = sinon.stub().callsArg(3, null, cache);
      as._updateAddressConfirmedSummaryCache(address, options, cache, tipHeight, function(err) {
        if (err) {
          return done(err);
        }
        as._saveAddressConfirmedSummaryCache.callCount.should.equal(1);
        done();
      });
    });

    it('will NOT save cache if exceeds threshold and IS height query', function(done) {
      var tipHeight = 12;
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      var options = {};
      var cache = {
        result: {
          txids: []
        }
      };
      as.summaryCacheThreshold = 1;
      as._getAddressConfirmedInputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._getAddressConfirmedOutputsSummary = sinon.stub().callsArgWith(3, null, cache);
      as._setAndSortTxidsFromAppearanceIds = sinon.stub().callsArgWith(1, null, cache);
      as._saveAddressConfirmedSummaryCache = sinon.stub().callsArg(3, null, cache);
      as._updateAddressConfirmedSummaryCache(address, options, cache, tipHeight, function(err) {
        if (err) {
          return done(err);
        }
        as._saveAddressConfirmedSummaryCache.callCount.should.equal(0);
        done();
      });
    });

  });

  describe('#_getAddressConfirmedInputsSummary', function() {
    it('will stream inputs and collect txids', function(done) {
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var cache = {
        height: 10,
        result: {
          appearanceIds: {}
        }
      };
      var options = {};
      var txid = 'f2cfc19d13f0c12199f70e420d84e2b3b1d4e499702aa9d737f8c24559c9ec47';
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      as.createInputsStream = sinon.stub().returns(streamStub);
      as._getAddressConfirmedInputsSummary(address, cache, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        cache.result.appearanceIds[txid].should.equal(10);
        done();
      });

      streamStub.emit('data', {
        txid: txid,
        height: 10
      });
      streamStub.push(null);
    });
    it('handle stream error', function(done) {
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var cache = {};
      var options = {};
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      as.createInputsStream = sinon.stub().returns(streamStub);
      as._getAddressConfirmedInputsSummary(address, cache, options, function(err, cache) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });

      streamStub.emit('error', new Error('test'));
      streamStub.push(null);
    });
  });

  describe('#_getAddressConfirmedOutputsSummary', function() {
    it('will stream inputs and collect txids', function(done) {
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub(),
            isSpent: sinon.stub().returns(false)
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var cache = {
        height: 10,
        result: {
          appearanceIds: {},
          unconfirmedAppearanceIds: {},
          balance: 0,
          totalReceived: 0,
          unconfirmedBalance: 0
        }
      };
      var options = {
        queryMempool: true
      };
      var txid = 'f2cfc19d13f0c12199f70e420d84e2b3b1d4e499702aa9d737f8c24559c9ec47';
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');

      as.createOutputsStream = sinon.stub().returns(streamStub);

      var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(new Buffer(txid, 'hex'), 2);
      as.mempoolSpentIndex[spentIndexSyncKey] = true;

      as._getAddressConfirmedOutputsSummary(address, cache, options, function(err, cache) {
        if (err) {
          return done(err);
        }
        cache.result.appearanceIds[txid].should.equal(10);
        cache.result.balance.should.equal(1000);
        cache.result.totalReceived.should.equal(1000);
        cache.result.unconfirmedBalance.should.equal(-1000);
        done();
      });

      streamStub.emit('data', {
        txid: txid,
        height: 10,
        outputIndex: 2,
        satoshis: 1000
      });
      streamStub.push(null);
    });
    it('handle stream error', function(done) {
      var streamStub = new stream.Readable();
      streamStub._read = function() { /* do nothing */ };
      var testnode = {
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        },
        datadir: 'testdir'
      };
      var as = new AddressService({
        mempoolMemoryIndex: true,
        node: testnode
      });
      var cache = {
        height: 10,
        result: {
          appearanceIds: {},
          unconfirmedAppearanceIds: {},
          balance: 0,
          totalReceived: 0,
          unconfirmedBalance: 0
        }
      };
      var options = {};
      var address = new bitcore.Address('12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX');
      as.createOutputsStream = sinon.stub().returns(streamStub);
      as._getAddressConfirmedOutputsSummary(address, cache, options, function(err, cache) {
        should.exist(err);
        err.message.should.equal('test');
        done();
      });

      streamStub.emit('error', new Error('test'));
      streamStub.push(null);
    });
  });

  describe.skip('#_setAndSortTxidsFromAppearanceIds', function() {
  });

  describe.skip('#_saveAddressConfirmedSummaryCache', function() {
  });

  describe.skip('#_getAddressMempoolSummary', function() {
  });

  describe.skip('#_transformAddressSummaryFromCache', function() {
  });

});
