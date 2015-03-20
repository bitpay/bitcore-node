'use strict';

var sinon = require('sinon');
var should = require('chai').should();
var events = require('events');
var Promise = require('bluebird');

var bitcore = require('bitcore');
var _ = bitcore.deps._;

var AddressService = require('../../lib/services/address');

describe('AddressService', function() {

  var database, rpc, blockService, transactionService, service;

  function initialize() {
    database = {};
    rpc = {};
    blockService = {};
    transactionService = {};
    service = new AddressService({
      database: database,
      transactionService: transactionService,
      blockService: blockService,
      rpc: rpc
    });
  }

  it('initializes correctly', function() {
    initialize();
    should.exist(service);
  });

  var thenCaller = {
    then: function(arg) {
      return arg();
    }
  };

  describe('getSummary', function() {

    beforeEach(initialize);

    it('calls internal functions as expected', function(done) {
      service.blockService = { getLatest: sinon.mock() };
      service.getAllOutputs = sinon.mock();
      service.getSpent = sinon.mock();
      service.buildAddressSummary = sinon.mock();

      service.blockService.getLatest.onFirstCall().returns(thenCaller);
      service.getAllOutputs.onFirstCall().returns(thenCaller);
      service.getSpent.onFirstCall().returns(thenCaller);
      service.buildAddressSummary.onFirstCall().returns(thenCaller);

      var address = 'address';
      var confirmations = 100;
      var promise = service.getSummary(address, confirmations);
      promise.then(function() {

        service.blockService.getLatest.calledOnce.should.equal(true);
        service.getAllOutputs.calledOnce.should.equal(true);
        service.getSpent.calledOnce.should.equal(true);
        service.buildAddressSummary.calledOnce.should.equal(true);

        done();
      });
    });

    it('processOutput works as expected', function() {
      AddressService.processOutput({
        key: 'txas-A-B-C',
        value: '{"a": "b"}'
      }).should.deep.equal({
        address: 'A',
        txId: 'B',
        outputIndex: 'C',
        a: 'b'
      });
    });

    it('getAllOutputs rejects promise on error', function(done) {
      var dataCall = new events.EventEmitter();
      var address = '12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S';
      service.database.createReadStream = sinon.mock();
      service.database.createReadStream.onFirstCall().returns(dataCall);
      service.getAllOutputs(address).catch(done);
      dataCall.emit('error');
    });

    it('getSpent rejects promise on error', function(done) {
      var address = '12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S';
      var dataCall = new events.EventEmitter();
      service.database.createReadStream = sinon.mock();
      service.database.createReadStream.onFirstCall().returns(dataCall);
      service.getSpent(address).catch(done);
      dataCall.emit('error');
    });

    it('getAllOutputs calls the expected functions', function(done) {
      service.database.createReadStream = sinon.mock();
      var dataCall = new events.EventEmitter();
      service.database.createReadStream.onFirstCall().returns(dataCall);

      AddressService.processOutput = sinon.stub(AddressService, 'processOutput');
      AddressService.processOutput.onFirstCall().returns('processed');

      var element = {key: 'key', value: 'value'};
      var address = '12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S';
      service.getAllOutputs(address).then(function(arg) {
        service.database.createReadStream.firstCall.args[0].should.deep.equal(
          {
            gte: 'txa-12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S-'
               + '0000000000000000000000000000000000000000000000000000000000000000-0',
            lte: 'txa-12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S-'
               + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff-4294967295'
          }
        );
        AddressService.processOutput.firstCall.args[0].should.equal(element);
        AddressService.processOutput.reset();
        arg[0].should.equal('processed');
        done();
      });

      dataCall.emit('data', element);
      dataCall.emit('end');
    });

    it('getSpent calls the expected functions', function(done) {
      service.database.createReadStream = sinon.mock();
      var dataCall = new events.EventEmitter();
      service.database.createReadStream.onFirstCall().returns(dataCall);

      var element = {key: 'key', value: JSON.stringify({a: 'b'})};
      var address = '12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S';
      service.getSpent(address).then(function(arg) {
        service.database.createReadStream.firstCall.args[0].should.deep.equal(
          {
            gte: 'txas-12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S-'
               + '0000000000000000000000000000000000000000000000000000000000000000-0',
            lte: 'txas-12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S-'
               + 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff-4294967295'
          }
        );
        arg[0].should.deep.equal({a: 'b'});
        done();
      });

      dataCall.emit('data', element);
      dataCall.emit('end');
    });
  });

  describe('buildAddressSummary', function() {

    beforeEach(initialize);
    var address = new bitcore.Address('12cbQLTFMXRnSzktFkuoG3eHoMeFtpTu3S');
    var tip = {
      height: 10
    };
    var allOutputs = [
      {
        satoshis: 10,
        txId: 'A',
        outputIndex: 1,
        heightConfirmed: 1
      }
    ];

    it('calculates balance correctly for confirmed balance', function() {
      var allOutputs = [ { satoshis: 10, txId: 'A', outputIndex: 1, heightConfirmed: 1 } ];
      var spendOutputs = [];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['A'],
        confirmed: { balance: 10, sent: 0, received: 10 },
        unconfirmed: { balance: 10, sent: 0, received: 10 }
      });
    });

    it('calculates balance correctly for unconfirmed balance', function() {
      var allOutputs = [
        { satoshis: 20, txId: 'B', outputIndex: 1, heightConfirmed: 10 }
      ];
      var spendOutputs = [ ];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['B'],
        confirmed: { balance: 0, sent: 0, received: 0 },
        unconfirmed: { balance: 20, sent: 0, received: 20 }
      });
    });

    it('works with multiple transactions', function() {
      var allOutputs = [
        { satoshis: 10, txId: 'A', outputIndex: 1, heightConfirmed: 1 },
        { satoshis: 20, txId: 'B', outputIndex: 1, heightConfirmed: 10 }
      ];
      var spendOutputs = [
        { spendInput: { prevTxId: 'A', outputIndex: 1 }, spentTx: 'A', heightSpent: 10 }
      ];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['A', 'B'],
        confirmed: { balance: 10, sent: 0, received: 10 },
        unconfirmed: { balance: 20, sent: 10, received: 30 }
      });
    });

    it('works with a medium amount of transactions', function() {
      var allOutputs = [
        { satoshis: 10, txId: 'A', outputIndex: 1, heightConfirmed: 1 },
        { satoshis: 20, txId: 'B', outputIndex: 1, heightConfirmed: 5 },
        { satoshis: 30, txId: 'C', outputIndex: 1, heightConfirmed: 10 }
      ];
      var spendOutputs = [
        { spendInput: { prevTxId: 'A', outputIndex: 1 }, spentTx: 'D', heightSpent: 10 }
      ];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['A', 'B', 'C', 'D'],
        confirmed: { balance: 30, sent: 0, received: 30 },
        unconfirmed: { balance: 50, sent: 10, received: 60 }
      });
    });

    it('works with a transaction that includes twice the same address', function() {
      var allOutputs = [
        { satoshis: 10, txId: 'A', outputIndex: 0, heightConfirmed: 1 },
        { satoshis: 10, txId: 'A', outputIndex: 1, heightConfirmed: 1 },
      ];
      var spendOutputs = [];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['A'],
        confirmed: { balance: 20, sent: 0, received: 20 },
        unconfirmed: { balance: 20, sent: 0, received: 20 }
      });
    });

    it('confirmed spent transactions change the balance', function() {
      var allOutputs = [
        { satoshis: 10, txId: 'A', outputIndex: 0, heightConfirmed: 1 },
      ];
      var spendOutputs = [
        { spendInput: { prevTxId: 'A', outputIndex: 0 }, spentTx: 'D', heightSpent: 2 }
      ];

      service.buildAddressSummary(address, tip, allOutputs, spendOutputs).should.deep.equal({
        address: address.toString(),
        transactions: ['A', 'D'],
        confirmed: { balance: 0, sent: 10, received: 10 },
        unconfirmed: { balance: 0, sent: 10, received: 10 }
      });
    });

  });
});

