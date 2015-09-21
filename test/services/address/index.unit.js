'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var bitcorenode = require('../../../');
var AddressService = bitcorenode.services.Address;
var blockData = require('../../data/livenet-345003.json');
var bitcore = require('bitcore');
var Script = bitcore.Script;
var Address = bitcore.Address;
var Networks = bitcore.Networks;
var EventEmitter = require('events').EventEmitter;
var errors = bitcorenode.errors;
var Transaction = require('../../../lib/transaction');
var txData = require('../../data/transaction.json');

var mockdb = {
};

var mocknode = {
  db: mockdb,
  services: {
    bitcoind: {
      on: sinon.stub()
    }
  }
};

describe('Address Service', function() {
  var txBuf = new Buffer(txData[0], 'hex');
  describe('#getAPIMethods', function() {
    it('should return the correct methods', function() {
      var am = new AddressService({node: mocknode});
      var methods = am.getAPIMethods();
      methods.length.should.equal(6);
    });
  });

  describe('#getPublishEvents', function() {
    it('will return an array of publish event objects', function() {
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
      am.node.network = Networks.livenet;
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var hashHex = bitcore.Address(address).hashBuffer.toString('hex');
      var messages = {};
      am.transactionOutputHandler(messages, tx, 0, true);
      should.exist(messages[hashHex]);
      var message = messages[hashHex];
      message.tx.should.equal(tx);
      message.outputIndexes.should.deep.equal([0]);
      message.addressInfo.hashBuffer.toString('hex').should.equal(hashHex);
      message.addressInfo.hashHex.should.equal(hashHex);
      message.rejected.should.equal(true);
    });
  });

  describe('#transactionHandler', function() {
    it('will pass outputs to transactionOutputHandler and call transactionEventHandler', function() {
      var txBuf = new Buffer('01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0704ffff001d0104ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be7947be63c52da7589379515d4e0a604f8141781e62294721166bf621e73a82cbf2342c858eeac00000000', 'hex');
      var am = new AddressService({node: mocknode});
      var address = '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX';
      var message = {};
      am.transactionOutputHandler = function(messages) {
        messages[address] = message;
      };
      am.transactionEventHandler = sinon.spy();
      am.transactionHandler({
        buffer: txBuf
      });
      am.transactionEventHandler.callCount.should.equal(1);
    });
  });

  describe('#_extractAddressInfoFromScript', function() {
    var am;
    before(function() {
      am = new AddressService({node: mocknode});
      am.node.network = Networks.livenet;
    });
    it('pay-to-publickey', function() {
      var pubkey = new bitcore.PublicKey('022df8750480ad5b26950b25c7ba79d3e37d75f640f8e5d9bcd5b150a0f85014da');
      var script = Script.buildPublicKeyOut(pubkey);
      var info = am._extractAddressInfoFromScript(script);
      info.addressType.should.equal(Address.PayToPublicKeyHash);
      info.hashBuffer.toString('hex').should.equal('9674af7395592ec5d91573aa8d6557de55f60147');
    });
    it('pay-to-publickeyhash', function() {
      var script = Script('OP_DUP OP_HASH160 20 0x0000000000000000000000000000000000000000 OP_EQUALVERIFY OP_CHECKSIG');
      var info = am._extractAddressInfoFromScript(script);
      info.addressType.should.equal(Address.PayToPublicKeyHash);
      info.hashBuffer.toString('hex').should.equal('0000000000000000000000000000000000000000');
    });
    it('pay-to-scripthash', function() {
      var script = Script('OP_HASH160 20 0x0000000000000000000000000000000000000000 OP_EQUAL');
      var info = am._extractAddressInfoFromScript(script);
      info.addressType.should.equal(Address.PayToScriptHash);
      info.hashBuffer.toString('hex').should.equal('0000000000000000000000000000000000000000');
    });
    it('non-address script type', function() {
      var buf = new Buffer(40);
      buf.fill(0);
      var script = Script('OP_RETURN 40 0x' + buf.toString('hex'));
      var info = am._extractAddressInfoFromScript(script);
      info.should.equal(false);
    });
  });

  describe('#blockHandler', function() {
    var am;
    var testBlock = bitcore.Block.fromString(blockData);

    before(function() {
      am = new AddressService({node: mocknode});
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
        operations.length.should.equal(81);
        operations[0].type.should.equal('put');
        operations[0].key.toString('hex').should.equal('0202a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b00000543abfdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e1692300000000');
        operations[0].value.toString('hex').should.equal('41e2a49ec1c0000076a91402a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b88ac');
        operations[3].type.should.equal('put');
        operations[3].key.toString('hex').should.equal('03fdbd324b28ea69e49c998816407dc055fb81d06e00000543ab3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a900000020');
        operations[3].value.toString('hex').should.equal('5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca00000000');
        operations[64].type.should.equal('put');
        operations[64].key.toString('hex').should.equal('029780ccd5356e2acc0ee439ee04e0fe69426c752800000543abe66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d00000001');
        operations[64].value.toString('hex').should.equal('4147a6b00000000076a9149780ccd5356e2acc0ee439ee04e0fe69426c752888ac');
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
        operations.length.should.equal(81);
        operations[0].type.should.equal('del');
        operations[0].key.toString('hex').should.equal('0202a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b00000543abfdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e1692300000000');
        operations[0].value.toString('hex').should.equal('41e2a49ec1c0000076a91402a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b88ac');
        operations[3].type.should.equal('del');
        operations[3].key.toString('hex').should.equal('03fdbd324b28ea69e49c998816407dc055fb81d06e00000543ab3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a900000020');
        operations[3].value.toString('hex').should.equal('5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca00000000');
        operations[64].type.should.equal('del');
        operations[64].key.toString('hex').should.equal('029780ccd5356e2acc0ee439ee04e0fe69426c752800000543abe66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d00000001');
        operations[64].value.toString('hex').should.equal('4147a6b00000000076a9149780ccd5356e2acc0ee439ee04e0fe69426c752888ac');
        done();
      });
    });
    it('should continue if output script is null', function(done) {
      var am = new AddressService({node: mocknode, network: 'livenet'});

      var block = {
        __height: 345003,
        header: {
          timestamp: 1424836934
        },
        transactions: [
          {
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
        db: db,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({node: testnode, network: 'livenet'});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
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
      var am = new AddressService({node: mocknode});
      am.getUnspentOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getBalance('someaddress', false, function(err) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });

  });

  describe('#getInputs', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address(address).hashBuffer;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
      services: {
        db: db,
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    before(function() {
      am = new AddressService({node: testnode});
    });

    it('will add mempool inputs on close', function(done) {
      var testStream = new EventEmitter();
      var db = {
        store: {
          createReadStream: sinon.stub().returns(testStream)
        }
      }
      var testnode = {
        services: {
          db: db,
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({node: testnode});
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      am.mempoolInputIndex[address] = [
        {
          address: address,
          height: -1,
          confirmations: 0
        }
      ]
      am.getInputs(address, args, function(err, inputs) {
        should.not.exist(err);
        inputs.length.should.equal(1);
        inputs[0].address.should.equal(address);
        inputs[0].height.should.equal(-1);
        done();
      });
      testStream.emit('close');
    });
    it('will get inputs for an address and timestamp', function(done) {
      var testStream = new EventEmitter();
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gte = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer, new Buffer('000000000c', 'hex')]);
          ops.gte.toString('hex').should.equal(gte.toString('hex'));
          var lte = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer, new Buffer('0000000010', 'hex')]);
          ops.lte.toString('hex').should.equal(lte.toString('hex'));
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
        key: new Buffer('33038a213afdfc551fc658e9a2a58a86e98d69b687000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000000', 'hex')
      };
      testStream.emit('data', data);
      testStream.emit('close');
    });
    it('should get inputs for address', function(done) {
      var testStream = new EventEmitter();
      var args = {
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gte = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer, new Buffer('00', 'hex')]);
          ops.gte.toString('hex').should.equal(gte.toString('hex'));
          var lte = Buffer.concat([AddressService.PREFIXES.SPENTS, hashBuffer, new Buffer('ff', 'hex')]);
          ops.lte.toString('hex').should.equal(lte.toString('hex'));
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
        key: new Buffer('33038a213afdfc551fc658e9a2a58a86e98d69b687000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000000', 'hex')
      };
      testStream.emit('data', data);
      testStream.emit('close');
    });
    it('should give an error if the readstream has an error', function(done) {
      var testStream = new EventEmitter();
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(testStream)
      };

      am.getOutputs(address, {}, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });

      testStream.emit('error', new Error('readstreamerror'));
      setImmediate(function() {
        testStream.emit('close');
      });
    });

  });

  describe('#getOutputs', function() {
    var am;
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
    var hashBuffer = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W').hashBuffer;
    var db = {
      tip: {
        __height: 1
      }
    };
    var testnode = {
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
      am = new AddressService({node: testnode});
    });

    it('will get outputs for an address and timestamp', function(done) {
      var testStream = new EventEmitter();
      var args = {
        start: 15,
        end: 12,
        queryMempool: true
      };
      var createReadStreamCallCount = 0;
      am.node.services.db.store = {
        createReadStream: function(ops) {
          var gte = Buffer.concat([AddressService.PREFIXES.OUTPUTS, hashBuffer, new Buffer('000000000c', 'hex')]);
          ops.gte.toString('hex').should.equal(gte.toString('hex'));
          var lte = Buffer.concat([AddressService.PREFIXES.OUTPUTS, hashBuffer, new Buffer('0000000010', 'hex')]);
          ops.lte.toString('hex').should.equal(lte.toString('hex'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am.getOutputs(address, args, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(1);
        outputs[0].address.should.equal(address);
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[0].height.should.equal(15);
        done();
      });
      createReadStreamCallCount.should.equal(1);
      var data = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b687000000000f125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('41f0de058a80000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };
      testStream.emit('data', data);
      testStream.emit('close');
    });

    it('should get outputs for an address', function(done) {
      var readStream1 = new EventEmitter();
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(readStream1)
      };

      am.mempoolOutputIndex = {};

      am.mempoolOutputIndex[address] = [
        {
          txid: 'aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371',
          satoshis: 307627737,
          script: '76a914f6db95c81dea3d10f0ff8d890927751bf7b203c188ac',
          outputIndex: 0
        }
      ]

      am.getOutputs(address, options, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(3);
        outputs[0].address.should.equal(address);
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[0].height.should.equal(345000);
        outputs[1].address.should.equal(address);
        outputs[1].txid.should.equal('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7');
        outputs[1].outputIndex.should.equal(2);
        outputs[1].satoshis.should.equal(10000);
        outputs[1].script.should.equal('76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac');
        outputs[1].height.should.equal(345004);
        outputs[2].address.should.equal(address);
        outputs[2].txid.should.equal('aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371');
        outputs[2].script.should.equal('76a914f6db95c81dea3d10f0ff8d890927751bf7b203c188ac');
        outputs[2].height.should.equal(-1);
        outputs[2].confirmations.should.equal(0);
        done();
      });

      var data1 = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b68700000543a8125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf8700000001', 'hex'),
        value: new Buffer('41f0de058a80000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };

      var data2 = {
        key: new Buffer('02038a213afdfc551fc658e9a2a58a86e98d69b68700000543ac3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae700000002', 'hex'),
        value: new Buffer('40c388000000000076a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac', 'hex')
      };

      readStream1.emit('data', data1);
      readStream1.emit('data', data2);
      readStream1.emit('close');
    });

    it('should give an error if the readstream has an error', function(done) {
      var readStream2 = new EventEmitter();
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
        readStream2.emit('close');
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
        services: {
          db: db,
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({node: testnode});
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
        db: db,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({node: testnode});
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
        db: db,
        services: {
          bitcoind: {
            on: sinon.stub()
          }
        }
      };
      var am = new AddressService({node: testnode});
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

      var am = new AddressService({node: mocknode});
      am.getOutputs = sinon.stub().callsArgWith(2, null, outputs);
      am.isUnspent = function(output, queryMempool, callback) {
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
      var am = new AddressService({node: mocknode});
      am.getOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getUnspentOutputsForAddress('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
    it('should handle when there are no outputs', function(done) {
      var am = new AddressService({node: mocknode});
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
      am = new AddressService({node: mocknode});
    });

    it('should give true when isSpent() gives false', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, false);
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(unspent) {
        unspent.should.equal(true);
        done();
      });
    });

    it('should give false when isSpent() gives true', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, true);
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(unspent) {
        unspent.should.equal(false);
        done();
      });
    });

    it('should give false when isSpent() returns an error', function(done) {
      am.isSpent = sinon.stub().callsArgWith(2, new Error('error'));
      am.isUnspent('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(unspent) {
        unspent.should.equal(false);
        done();
      });
    });
  });

  describe('#isSpent', function() {
    var am;
    var db = {};
    var testnode = {
      db: db,
      services: {
        bitcoind: {
          on: sinon.stub()
        }
      }
    };
    before(function() {
      am = new AddressService({node: testnode});
      am.node.services.bitcoind = {
        isSpent: sinon.stub().returns(true),
        on: sinon.stub()
      };
    });

    it('should give true if bitcoind.isSpent gives true', function(done) {
      am.isSpent('output', true, function(spent) {
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
      var am = new TestAddressService({node: mocknode});
      am.getAddressHistory([], {}, function(err, history) {
        TestAddressHistory.prototype.get.callCount.should.equal(1);
        done();
      });
    });
  });
  describe('#updateMempoolIndex', function() {
    var am;
    var db = {};
    var tx = Transaction().fromBuffer(txBuf);

    before(function() {
      am = new AddressService({node: mocknode});
    });

    it('will update the input and output indexes', function() {
      am.updateMempoolIndex(tx);
      am.mempoolInputIndex['18Z29uNgWyUDtNyTKE1PaurbSR131EfANc'][0].txid.should.equal('45202ffdeb8344af4dec07cddf0478485dc65cc7d08303e45959630c89b51ea2');
      am.mempoolOutputIndex['12w93weN8oti3P1e5VYEuygqyujhADF7J5'][0].txid.should.equal('45202ffdeb8344af4dec07cddf0478485dc65cc7d08303e45959630c89b51ea2');
      am.mempoolInputIndex['1JT7KDYwT9JY9o2vyqcKNSJgTWeKfV3ui8'].length.should.equal(12);
      am.mempoolOutputIndex['12w93weN8oti3P1e5VYEuygqyujhADF7J5'].length.should.equal(1);
    });

  });
  describe('#resetMempoolIndex', function() {
    var am;
    var db = {};

    before(function() {
      var testnode = {
        db: db,
        services: {
          bitcoind: {
            getMempoolTransactions: sinon.stub().returns([txBuf]),
            on: sinon.stub()
          }
        }
      };
      am = new AddressService({node: testnode});
      am.updateMempoolIndex = sinon.stub();

    });
    it('will reset the input and output indexes', function(done) {
      am.resetMempoolIndex(function() {
        am.updateMempoolIndex.callCount.should.equal(1);
        done();
      });
    });
  });
  describe('#getAddressSummary', function() {
    var node = {
      services: {
        bitcoind: {
          isSpent: sinon.stub().returns(false),
          on: sinon.spy()
        }
      }
    };
    var inputs = [
      {
        "txid": "9f183412de12a6c1943fc86c390174c1cde38d709217fdb59dcf540230fa58a6",
        "height": -1,
        "confirmations": 0,
        "addresses": {
          "mpkDdnLq26djg17s6cYknjnysAm3QwRzu2": {
            "outputIndexes": [],
            "inputIndexes": [
              3
            ]
          }
        },
        "address": "mpkDdnLq26djg17s6cYknjnysAm3QwRzu2"
      }
    ];

    var outputs = [
      {
        "address": "mpkDdnLq26djg17s6cYknjnysAm3QwRzu2",
        "txid": "689e9f543fa4aa5b2daa3b5bb65f9a00ad5aa1a2e9e1fc4e11061d85f2aa9bc5",
        "outputIndex": 0,
        "height": 556351,
        "satoshis": 3487110,
        "script": "76a914653b58493c2208481e0902a8ffb97b8112b13fe188ac",
        "confirmations": 13190
      }
    ];

    var as = new AddressService({node: node});
    as.getInputs = sinon.stub().callsArgWith(2, null, inputs);
    as.getOutputs = sinon.stub().callsArgWith(2, null, outputs);
    as.mempoolSpentIndex = {
      '689e9f543fa4aa5b2daa3b5bb65f9a00ad5aa1a2e9e1fc4e11061d85f2aa9bc5-0': true
    };

    it('should handle unconfirmed and confirmed outputs and inputs', function(done) {
      as.getAddressSummary('mpkDdnLq26djg17s6cYknjnysAm3QwRzu2', {}, function(err, summary) {
        should.not.exist(err);
        summary.totalReceived.should.equal(3487110);
        summary.totalSpent.should.equal(0);
        summary.balance.should.equal(3487110);
        summary.unconfirmedBalance.should.equal(0);
        summary.appearances.should.equal(1);
        summary.unconfirmedAppearances.should.equal(1);
        summary.txids.should.deep.equal(
          [
            '9f183412de12a6c1943fc86c390174c1cde38d709217fdb59dcf540230fa58a6',
            '689e9f543fa4aa5b2daa3b5bb65f9a00ad5aa1a2e9e1fc4e11061d85f2aa9bc5'
          ]
        );
        done();
      });
    });
    it('noTxList should not include txids array', function(done) {
      as.getAddressSummary('mpkDdnLq26djg17s6cYknjnysAm3QwRzu2', {noTxList: true}, function(err, summary) {
        should.not.exist(err);
        summary.totalReceived.should.equal(3487110);
        summary.totalSpent.should.equal(0);
        summary.balance.should.equal(3487110);
        summary.unconfirmedBalance.should.equal(0);
        summary.appearances.should.equal(1);
        summary.unconfirmedAppearances.should.equal(1);
        should.not.exist(summary.txids);
        done();
      });
    });
  });
});
