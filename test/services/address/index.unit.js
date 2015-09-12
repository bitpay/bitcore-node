'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var proxyquire = require('proxyquire');
var bitcorenode = require('../../../');
var AddressService = bitcorenode.services.Address;
var blockData = require('../../data/livenet-345003.json');
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var EventEmitter = require('events').EventEmitter;
var errors = bitcorenode.errors;

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

  describe('#getAPIMethods', function() {
    it('should return the correct methods', function() {
      var am = new AddressService({node: mocknode});
      var methods = am.getAPIMethods();
      methods.length.should.equal(5);
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

  describe('#blockHandler', function() {
    var am;
    var testBlock = bitcore.Block.fromString(blockData);

    var data = [
      {
        key: {
          hashHex: bitcore.Address('1F1MAvhTKg2VG29w8cXsiSN2PJ8gSsrJw').hashBuffer.toString('hex'),
          height: 345003,
          txid: 'fdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e16923',
          outputIndex: 0
        },
        value: {
          satoshis: 2502227470,
          script: '76a91402a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b88ac',
          blockHeight: 345003
        }
      },
      {
        key: {
          hashHex: bitcore.Address('1Q8ec8kG7c7HqgK7uSzQyWsX9tzepRcKEL').hashBuffer.toString('hex'),
          height: 345003,
          prevTxId: '3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a9',
          prevOutputIndex: 32
        },
        value: {
          txid: '5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca',
          inputIndex: 0
        }
      },
      {
        key: {
          hashHex: bitcore.Address('1Ep5LA4T6Y7zaBPiwruUJurjGFvCJHzJhm').hashBuffer.toString('hex'),
          height: 345003,
          txid: 'e66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d',
          outputIndex: 1
        },
        value: {
          satoshis: 3100000,
          script: '76a9149780ccd5356e2acc0ee439ee04e0fe69426c752888ac',
          blockHeight: 345003
        }
      }
    ];
    var key0 = data[0].key;
    var value0 = data[0].value;
    var key3 = data[1].key;
    var value3 = data[1].value;
    var key64 = data[2].key;
    var value64 = data[2].value;

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
        var expected0 = ['outs', key0.hashHex, key0.height, key0.txid, key0.outputIndex].join('-');
        operations[0].key.should.equal(expected0);
        operations[0].value.should.equal([value0.satoshis, value0.script].join(':'));
        operations[3].type.should.equal('put');
        var expected3 = ['sp', key3.hashHex, key3.height, key3.prevTxId, key3.prevOutputIndex].join('-');
        operations[3].key.should.equal(expected3);
        operations[3].value.should.equal([value3.txid, value3.inputIndex].join(':'));
        operations[64].type.should.equal('put');
        var expected64 = ['outs', key64.hashHex, key64.height, key64.txid, key64.outputIndex].join('-');
        operations[64].key.should.equal(expected64);
        operations[64].value.should.equal([value64.satoshis, value64.script].join(':'));
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
        operations[0].key.should.equal(['outs', key0.hashHex, key0.height, key0.txid, key0.outputIndex].join('-'));
        operations[0].value.should.equal([value0.satoshis, value0.script].join(':'));
        operations[3].type.should.equal('del');
        operations[3].key.should.equal(['sp', key3.hashHex, key3.height, key3.prevTxId, key3.prevOutputIndex].join('-'));
        operations[3].value.should.equal([value3.txid, value3.inputIndex].join(':'));
        operations[64].type.should.equal('del');
        operations[64].key.should.equal(['outs', key64.hashHex, key64.height, key64.txid, key64.outputIndex].join('-'));
        operations[64].value.should.equal([value64.satoshis, value64.script].join(':'));
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
    var hashHex = bitcore.Address(address).hashBuffer.toString('hex');
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
          ops.start.should.equal([AddressService.PREFIXES.SPENTS, hashHex, 12].join('-'));
          ops.end.should.equal([AddressService.PREFIXES.SPENTS, hashHex, 16].join('-'));
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
        key: ['sp', address, '15', '125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87', '1'].join('-'),
        value: ['3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', '0'].join(':')
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
          ops.start.should.equal([AddressService.PREFIXES.SPENTS, hashHex].join('-'));
          ops.end.should.equal([AddressService.PREFIXES.SPENTS, hashHex].join('-') + '~');
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
        key: ['sp', address, '15', '125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87', '1'].join('-'),
        value: ['3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', '0'].join(':')
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
    var hashHex = bitcore.Address('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W').hashBuffer.toString('hex');
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
          ops.start.should.equal([AddressService.PREFIXES.OUTPUTS, hashHex, 12].join('-'));
          ops.end.should.equal([AddressService.PREFIXES.OUTPUTS, hashHex, 16].join('-'));
          createReadStreamCallCount++;
          return testStream;
        }
      };
      am.node.services.bitcoind = {
        getMempoolOutputs: sinon.stub().returns([])
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
        key: ['outs', address, '15', '125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87', '1'].join('-'),
        value: ['4527773864', '76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac'].join(':')
      };
      testStream.emit('data', data);
      testStream.emit('close');
    });

    it('should get outputs for an address', function(done) {
      var readStream1 = new EventEmitter();
      am.node.services.db.store = {
        createReadStream: sinon.stub().returns(readStream1)
      };
      var mempoolOutputs = [
        {
          address: '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W',
          txid: 'aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371',
          satoshis: 307627737,
          script: '76a914f6db95c81dea3d10f0ff8d890927751bf7b203c188ac',
          blockHeight: 352532
        }
      ];
      am.node.services.bitcoind = {
        getMempoolOutputs: sinon.stub().returns(mempoolOutputs)
      };

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
        outputs[2].blockHeight.should.equal(352532);
        done();
      });

      var data1 = {
        key: ['outs', address, 345000, '125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87', '1'].join('-'),
        value: ['4527773864', '76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac'].join(':')
      };

      var data2 = {
        key: ['outs', address, 345004, '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', '2'].join('-'),
        value: ['10000', '76a914038a213afdfc551fc658e9a2a58a86e98d69b68788ac'].join(':')
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

});
