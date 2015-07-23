'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var chainlib = require('chainlib');
var levelup = chainlib.deps.levelup;
var bitcoindjs = require('../../');
var AddressModule = bitcoindjs.modules.AddressModule;
var blockData = require('../data/livenet-345003.json');
var bitcore = require('bitcore');
var EventEmitter = require('events').EventEmitter;
var errors = bitcoindjs.errors;

describe('AddressModule', function() {

  describe('#methods', function() {
    it('should return the correct methods', function() {
      var am = new AddressModule({});
      var methods = am.methods();
      methods.length.should.equal(4);
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
        operations.length.should.equal(11);
        operations[0].type.should.equal('put');
        var expected0 = ['outs', key0.address, key0.timestamp, key0.txid, key0.outputIndex].join('-');
        operations[0].key.should.equal(expected0);
        operations[0].value.should.equal([value0.satoshis, value0.script, value0.blockHeight].join(':'));
        done();
      });
    });
    it('should create the correct operations when removing outputs', function(done) {
      am.blockHandler({__height: 345003, timestamp: new Date(1424836934000)}, false, function(err, operations) {
        should.not.exist(err);
        operations.length.should.equal(11);
        operations[0].type.should.equal('del');
        operations[0].key.should.equal(['outs', key0.address, key0.timestamp, key0.txid, key0.outputIndex].join('-'));
        operations[0].value.should.equal([value0.satoshis, value0.script, value0.blockHeight].join(':'));
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

});
