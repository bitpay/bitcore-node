'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcoindjs = require('../../');
var AddressModule = bitcoindjs.modules.AddressModule;
var blockData = require('../data/livenet-345003.json');
var bitcore = require('bitcore');
var EventEmitter = require('events').EventEmitter;
var errors = bitcoindjs.errors;
var chainlib = require('chainlib');
var levelup = chainlib.deps.levelup;

describe('AddressModule', function() {

  describe('#getAPIMethods', function() {
    it('should return the correct methods', function() {
      var am = new AddressModule({});
      var methods = am.getAPIMethods();
      methods.length.should.equal(5);
    });
  });

  describe('#getPublishEvents', function() {
    it('will return an array of publish event objects', function() {
      var am = new AddressModule({});
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

  describe('#blockHandler', function() {
    var block = bitcore.Block.fromString(blockData);
    var db = {
      getTransactionsFromBlock: function() {
        return block.transactions.slice(0, 8);
      }
    };
    var am = new AddressModule({db: db, network: 'livenet'});

    var data = [
      {
        key: {
          address: '1F1MAvhTKg2VG29w8cXsiSN2PJ8gSsrJw',
          timestamp: 1424836934000,
          txid: 'fdbefe0d064729d85556bd3ab13c3a889b685d042499c02b4aa2064fb1e16923',
          outputIndex: 0
        },
        value: {
          satoshis: 2502227470,
          script: 'OP_DUP OP_HASH160 20 0x02a61d2066d19e9e2fd348a8320b7ebd4dd3ca2b OP_EQUALVERIFY OP_CHECKSIG',
          blockHeight: 345003
        }
      },
      {
        key: {
          prevTxId: '3d7d5d98df753ef2a4f82438513c509e3b11f3e738e94a7234967b03a03123a9',
          prevOutputIndex: 32
        },
        value: {
          txid: '5780f3ee54889a0717152a01abee9a32cec1b0cdf8d5537a08c7bd9eeb6bfbca',
          inputIndex: 0,
          timestamp: 1424836934000
        }
      },
      {
        key: {
          address: '1Ep5LA4T6Y7zaBPiwruUJurjGFvCJHzJhm',
          timestamp: 1424836934000,
          txid: 'e66f3b989c790178de2fc1a5329f94c0d8905d0d3df4e7ecf0115e7f90a6283d',
          outputIndex: 1
        },
        value: {
          satoshis: 3100000,
          script: 'OP_DUP OP_HASH160 20 0x9780ccd5356e2acc0ee439ee04e0fe69426c7528 OP_EQUALVERIFY OP_CHECKSIG',
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

    it('should create the correct operations when updating/adding outputs', function(done) {
      am.blockHandler({__height: 345003, timestamp: new Date(1424836934000)}, true, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(81);
        operations[0].type.should.equal('put');
        var expected0 = ['outs', key0.address, key0.timestamp, key0.txid, key0.outputIndex].join('-');
        operations[0].key.should.equal(expected0);
        operations[0].value.should.equal([value0.satoshis, value0.script, value0.blockHeight].join(':'));
        operations[3].type.should.equal('put');
        var expected3 = ['sp', key3.prevTxId, key3.prevOutputIndex].join('-');
        operations[3].key.should.equal(expected3);
        operations[3].value.should.equal([value3.txid, value3.inputIndex].join(':'));
        operations[64].type.should.equal('put');
        var expected64 = ['outs', key64.address, key64.timestamp, key64.txid, key64.outputIndex].join('-');
        operations[64].key.should.equal(expected64);
        operations[64].value.should.equal([value64.satoshis, value64.script, value64.blockHeight].join(':'));
        done();
      });
    });
    it('should create the correct operations when removing outputs', function(done) {
      am.blockHandler({__height: 345003, timestamp: new Date(1424836934000)}, false, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(81);
        operations[0].type.should.equal('del');
        operations[0].key.should.equal(['outs', key0.address, key0.timestamp, key0.txid, key0.outputIndex].join('-'));
        operations[0].value.should.equal([value0.satoshis, value0.script, value0.blockHeight].join(':'));
        operations[3].type.should.equal('del');
        operations[3].key.should.equal(['sp', key3.prevTxId, key3.prevOutputIndex].join('-'));
        operations[3].value.should.equal([value3.txid, value3.inputIndex].join(':'));
        operations[64].type.should.equal('del');
        operations[64].key.should.equal(['outs', key64.address, key64.timestamp, key64.txid, key64.outputIndex].join('-'));
        operations[64].value.should.equal([value64.satoshis, value64.script, value64.blockHeight].join(':'));
        done();
      });
    });
    it('should continue if output script is null', function(done) {
      var transactions = [
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
      ];
      var db = {
        getTransactionsFromBlock: function() {
          return transactions;
        }
      };

      var am = new AddressModule({db: db, network: 'livenet'});

      am.blockHandler({__height: 345003, timestamp: new Date(1424836934000)}, false, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(0);
        done();
      });
    });
    it('will call event handlers', function() {
      var block = bitcore.Block.fromString(blockData);
      var db = {
        getTransactionsFromBlock: function() {
          return block.transactions.slice(0, 8);
        }
      };
      var am = new AddressModule({db: db, network: 'livenet'});
      am.transactionEventHandler = sinon.spy();
      am.balanceEventHandler = sinon.spy();
      am.blockHandler(
        {
          __height: 345003,
          timestamp: new Date(1424836934000)
        },
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
      var am = new AddressModule({});
      var emitter = new EventEmitter();
      am.subscriptions.transaction = {
        '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N': [emitter]
      };
      var block = {};
      var tx = {};
      emitter.on('transaction', function(address, t, b) {
        address.should.equal('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
        t.should.equal(tx);
        b.should.equal(block);
        done();
      });
      am.transactionEventHandler(block, '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N', tx);
    });
  });

  describe('#balanceEventHandler', function() {
    it('will emit a balance if there is a subscriber', function(done) {
      var am = new AddressModule({});
      var emitter = new EventEmitter();
      am.subscriptions.balance = {
        '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N': [emitter]
      };
      var block = {};
      var balance = 1000;
      am.getBalance = sinon.stub().callsArgWith(2, null, balance);
      emitter.on('balance', function(address, bal, b) {
        address.should.equal('1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
        bal.should.equal(balance);
        b.should.equal(block);
        done();
      });
      am.balanceEventHandler(block, '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N');
    });
  });

  describe('#subscribe', function() {
    it('will add emitters to the subscribers array (transaction)', function() {
      var am = new AddressModule({});
      var emitter = new EventEmitter();

      var address = '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N';
      var name = 'transaction';
      am.subscribe(name, emitter, [address]);
      am.subscriptions.transaction[address].should.deep.equal([emitter]);

      var address2 = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      am.subscribe(name, emitter, [address2]);
      am.subscriptions.transaction[address2].should.deep.equal([emitter]);

      var emitter2 = new EventEmitter();
      am.subscribe(name, emitter2, [address]);
      am.subscriptions.transaction[address].should.deep.equal([emitter, emitter2]);
    });
    it('will add an emitter to the subscribers array (balance)', function() {
      var am = new AddressModule({});
      var emitter = new EventEmitter();
      var name = 'balance';
      var address = '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N';
      am.subscribe(name, emitter, [address]);
      am.subscriptions.balance[address].should.deep.equal([emitter]);

      var address2 = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';
      am.subscribe(name, emitter, [address2]);
      am.subscriptions.balance[address2].should.deep.equal([emitter]);

      var emitter2 = new EventEmitter();
      am.subscribe(name, emitter2, [address]);
      am.subscriptions.balance[address].should.deep.equal([emitter, emitter2]);
    });
  });

  describe('#unsubscribe', function() {
    it('will remove emitter from subscribers array (transaction)', function() {
      var am = new AddressModule({});
      var emitter = new EventEmitter();
      var emitter2 = new EventEmitter();
      var address = '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N';
      am.subscriptions.transaction[address] = [emitter, emitter2];
      var name = 'transaction';
      am.unsubscribe(name, emitter, [address]);
      am.subscriptions.transaction[address].should.deep.equal([emitter2]);
    });
    it('will remove emitter from subscribers array (balance)', function() {
      var am = new AddressModule({});
      var emitter = new EventEmitter();
      var emitter2 = new EventEmitter();
      var address = '1DzjESe6SLmAKVPLFMj6Sx1sWki3qt5i8N';
      var name = 'balance';
      am.subscriptions.balance[address] = [emitter, emitter2];
      am.unsubscribe(name, emitter, [address]);
      am.subscriptions.balance[address].should.deep.equal([emitter2]);
    });
  });

  describe('#getBalance', function() {
    it('should sum up the unspent outputs', function(done) {
      var am = new AddressModule({});
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
      var am = new AddressModule({});
      am.getUnspentOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getBalance('someaddress', false, function(err) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });

  });

  describe('#getOutputs', function() {
    var am = new AddressModule({db: {}});
    var address = '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W';

    it('should get outputs for an address', function(done) {
      var readStream1 = new EventEmitter();
      am.db.store = {
        createReadStream: sinon.stub().returns(readStream1)
      };
      var mempoolOutputs = [
        {
          address: '1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W',
          txid: 'aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371',
          satoshis: 307627737,
          script: 'OP_DUP OP_HASH160 f6db95c81dea3d10f0ff8d890927751bf7b203c1 OP_EQUALVERIFY OP_CHECKSIG',
          blockHeight: 352532
        }
      ];
      am.db.bitcoind = {
        getMempoolOutputs: sinon.stub().returns(mempoolOutputs)
      };

      am.getOutputs(address, true, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(3);
        outputs[0].address.should.equal(address);
        outputs[0].txid.should.equal('125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87');
        outputs[0].outputIndex.should.equal(1);
        outputs[0].satoshis.should.equal(4527773864);
        outputs[0].script.should.equal('OP_DUP OP_HASH160 038a213afdfc551fc658e9a2a58a86e98d69b687 OP_EQUALVERIFY OP_CHECKSIG');
        outputs[0].blockHeight.should.equal(345000);
        outputs[1].address.should.equal(address);
        outputs[1].txid.should.equal('3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7');
        outputs[1].outputIndex.should.equal(2);
        outputs[1].satoshis.should.equal(10000);
        outputs[1].script.should.equal('OP_DUP OP_HASH160 038a213afdfc551fc658e9a2a58a86e98d69b687 OP_EQUALVERIFY OP_CHECKSIG');
        outputs[1].blockHeight.should.equal(345004);
        outputs[2].address.should.equal(address);
        outputs[2].txid.should.equal('aa2db23f670596e96ed94c405fd11848c8f236d266ee96da37ecd919e53b4371');
        outputs[2].script.should.equal('OP_DUP OP_HASH160 f6db95c81dea3d10f0ff8d890927751bf7b203c1 OP_EQUALVERIFY OP_CHECKSIG');
        outputs[2].blockHeight.should.equal(352532);
        done();
      });

      var data1 = {
        key: ['outs', address, '1424835319000', '125dd0e50fc732d67c37b6c56be7f9dc00b6859cebf982ee2cc83ed2d604bf87', '1'].join('-'),
        value: ['4527773864', 'OP_DUP OP_HASH160 038a213afdfc551fc658e9a2a58a86e98d69b687 OP_EQUALVERIFY OP_CHECKSIG', '345000'].join(':')
      };

      var data2 = {
        key: ['outs', address, '1424837300000', '3b6bc2939d1a70ce04bc4f619ee32608fbff5e565c1f9b02e4eaa97959c59ae7', '2'].join('-'),
        value: ['10000', 'OP_DUP OP_HASH160 038a213afdfc551fc658e9a2a58a86e98d69b687 OP_EQUALVERIFY OP_CHECKSIG', '345004'].join(':')
      };

      readStream1.emit('data', data1);
      readStream1.emit('data', data2);
      readStream1.emit('close');
    });

    it('should give an error if the readstream has an error', function(done) {
      var readStream2 = new EventEmitter();
      am.db.store = {
        createReadStream: sinon.stub().returns(readStream2)
      };

      am.getOutputs(address, true, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('readstreamerror');
        done();
      });

      readStream2.emit('error', new Error('readstreamerror'));
      process.nextTick(function() {
        readStream2.emit('close');
      });
    });
  });

  describe('#getUnspentOutputs', function() {
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

      var am = new AddressModule({});
      am.getOutputs = sinon.stub().callsArgWith(2, null, outputs);
      am.isUnspent = function(output, queryMempool, callback) {
        callback(!outputs[i].spent);
        i++;
      };

      am.getUnspentOutputs('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.not.exist(err);
        outputs.length.should.equal(2);
        outputs[0].satoshis.should.equal(1000);
        outputs[1].satoshis.should.equal(3000);
        done();
      });
    });
    it('should handle an error from getOutputs', function(done) {
      var am = new AddressModule({});
      am.getOutputs = sinon.stub().callsArgWith(2, new Error('error'));
      am.getUnspentOutputs('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.exist(err);
        err.message.should.equal('error');
        done();
      });
    });
    it('should handle when there are no outputs', function(done) {
      var am = new AddressModule({});
      am.getOutputs = sinon.stub().callsArgWith(2, null, []);
      am.getUnspentOutputs('1KiW1A4dx1oRgLHtDtBjcunUGkYtFgZ1W', false, function(err, outputs) {
        should.exist(err);
        err.should.be.instanceof(errors.NoOutputs);
        outputs.length.should.equal(0);
        done();
      });
    });
  });

  describe('#isUnspent', function() {
    var am = new AddressModule({});

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
    var am = new AddressModule({db: {}});
    am.db.bitcoind = {
      isSpent: sinon.stub().returns(true)
    };

    it('should give true if bitcoind.isSpent gives true', function(done) {
      am.isSpent('output', true, function(spent) {
        spent.should.equal(true);
        done();
      });
    });
  });

  describe('#getSpendInfoForOutput', function() {
    it('should call store.get the right values', function(done) {
      var db = {
        store: {
          get: sinon.stub().callsArgWith(1, null, 'spendtxid:1')
        }
      };
      var am = new AddressModule({db: db});
      am.getSpendInfoForOutput('txid', 3, function(err, info) {
        should.not.exist(err);
        info.txid.should.equal('spendtxid');
        info.inputIndex.should.equal('1');
        db.store.get.args[0][0].should.equal('sp-txid-3');
        done();
      });
    });
  });

  describe('#getAddressHistory', function() {
    var incoming = [
      {
        txid: 'tx1',
        outputIndex: 0,
        spentTx: 'tx2',
        inputIndex: 0,
        height: 1,
        timestamp: 1438289011844,
        satoshis: 5000
      },
      {
        txid: 'tx3',
        outputIndex: 1,
        height: 3,
        timestamp: 1438289031844,
        satoshis: 2000
      },
      {
        txid: 'tx4',
        outputIndex: 2,
        spentTx: 'tx5',
        inputIndex: 1,
        height: 4,
        timestamp: 1438289041844,
        satoshis: 3000
      },
    ];

    var outgoing = [
      {
        txid: 'tx2',
        height: 2,
        timestamp: 1438289021844,
        inputs: [
          {
            output: {
              satoshis: 5000
            }
          }
        ]
      },
      {
        txid: 'tx5',
        height: 5,
        timestamp: 1438289051844,
        inputs: [
          {},
          {
            output: {
              satoshis: 3000
            }
          }
        ]
      }
    ];

    var db = {
      getTransactionWithBlockInfo: function(txid, queryMempool, callback) {
        var transaction = {
          populateInputs: sinon.stub().callsArg(2)
        };
        for(var i = 0; i < incoming.length; i++) {
          if(incoming[i].txid === txid) {
            if(incoming[i].error) {
              return callback(new Error(incoming[i].error));
            }
            transaction.hash = txid;
            transaction.__height = incoming[i].height;
            transaction.__timestamp = incoming[i].timestamp;
            return callback(null, transaction);
          }
        }

        for(var i = 0; i < outgoing.length; i++) {
          if(outgoing[i].txid === txid) {
            if(outgoing[i].error) {
              return callback(new Error(outgoing[i].error));
            }
            transaction.hash = txid;
            transaction.__height = outgoing[i].height;
            transaction.__timestamp = outgoing[i].timestamp;
            transaction.inputs = outgoing[i].inputs;
            return callback(null, transaction);
          }
        }
        callback(new Error('tx ' + txid + ' not found'));
      }
    };
    var am = new AddressModule({db: db});

    am.getOutputs = sinon.stub().callsArgWith(2, null, incoming);
    am.getSpendInfoForOutput = function(txid, outputIndex, callback) {
      for(var i = 0; i < incoming.length; i++) {
        if(incoming[i].txid === txid && incoming[i].outputIndex === outputIndex && incoming[i].spentTx) {
          if(incoming[i].spendError) {
            return callback(new Error(incoming[i].spendError));
          }
          return callback(null, {
            txid: incoming[i].spentTx,
            inputIndex: incoming[i].inputIndex
          });
        }
      }

      callback(new levelup.errors.NotFoundError());
    };

    it('should give transaction history for an address', function(done) {
      am.getAddressHistory('address', true, function(err, history) {
        should.not.exist(err);
        history[0].transaction.hash.should.equal('tx1');
        history[0].satoshis.should.equal(5000);
        history[0].height.should.equal(1);
        history[0].timestamp.should.equal(1438289011844);
        history[1].transaction.hash.should.equal('tx2');
        history[1].satoshis.should.equal(-5000);
        history[1].height.should.equal(2);
        history[1].timestamp.should.equal(1438289021844);
        history[2].transaction.hash.should.equal('tx3');
        history[2].satoshis.should.equal(2000);
        history[2].height.should.equal(3);
        history[2].timestamp.should.equal(1438289031844);
        history[3].transaction.hash.should.equal('tx4');
        history[3].satoshis.should.equal(3000);
        history[3].height.should.equal(4);
        history[3].timestamp.should.equal(1438289041844);
        history[4].transaction.hash.should.equal('tx5');
        history[4].satoshis.should.equal(-3000);
        history[4].height.should.equal(5);
        history[4].timestamp.should.equal(1438289051844);
        done();
      });
    });

    it('should give an error if the second getTransactionInfo gives an error', function(done) {
      outgoing[0].error = 'txinfo2err';
      am.getAddressHistory('address', true, function(err, history) {
        should.exist(err);
        err.message.should.equal('txinfo2err');
        outgoing[0].error = null;
        done();
      });
    });

    it('should give an error if getSpendInfoForOutput gives an error', function(done) {
      incoming[0].spendError = 'spenderr';
      am.getAddressHistory('address', true, function(err, history) {
        should.exist(err);
        err.message.should.equal('spenderr');
        incoming[0].spendError = null;
        done();
      });
    });

    it('should give an error if the first getTransactionInfo gives an error', function(done) {
      incoming[1].error = 'txinfo1err';
      am.getAddressHistory('address', true, function(err, history) {
        should.exist(err);
        err.message.should.equal('txinfo1err');
        incoming[1].error = null;
        done();
      });
    });

    it('should give an error if populateInputs gives an error', function(done) {
      var populateStub = sinon.stub().callsArgWith(2, new Error('populateerr'));
      sinon.stub(db, 'getTransactionWithBlockInfo').callsArgWith(2, null, {
        populateInputs: populateStub
      });
      am.getAddressHistory('address', true, function(err, history) {
        should.exist(err);
        err.message.should.equal('populateerr');
        db.getTransactionWithBlockInfo.restore();
        done();
      });
    });

    it('should give an error if getOutputs gives an error', function(done) {
      am.getOutputs = sinon.stub().callsArgWith(2, new Error('getoutputserr'));
      am.getAddressHistory('address', true, function(err, history) {
        should.exist(err);
        err.message.should.equal('getoutputserr');
        done();
      });
    });
  });

});
