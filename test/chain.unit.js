'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var async = require('async');
var proxyquire = require('proxyquire');
var memdown = require('memdown');

var bitcoindjs = require('../');
var DB = bitcoindjs.DB;
var Chain = bitcoindjs.Chain;
var Block = bitcoindjs.Block;

var chainData = require('./data/testnet-blocks.json');

describe('Bitcoin Chain', function() {

  describe('@constructor', function() {
    
    it('can create a new instance with and without `new`', function() {
      var chain = new Chain();
      chain = Chain();
    });

  });

  describe('#_writeBlock', function() {
    it('should update hashes and call putBlock', function(done) {
      var chain = new Chain();
      chain.db = {
        putBlock: sinon.stub().callsArg(1)
      };
      chain._writeBlock({hash: 'hash', prevHash: 'prevhash'}, function(err) {
        should.not.exist(err);
        chain.db.putBlock.callCount.should.equal(1);
        chain.cache.hashes.hash.should.equal('prevhash');
        done();
      });
    });
  });

  describe('#_validateBlock', function() {
    it('should call the callback', function(done) {
      var chain = new Chain();
      chain._validateBlock('block', function(err) {
        should.not.exist(err);
        done();
      });
    });
  });

  describe('#getInterval', function() {

    it('get default interval', function() {
      var chain = new Chain();
      chain.targetTimespan.toString(10).should.equal('1209600000');
      chain.targetSpacing.toString(10).should.equal('600000');
      chain.getDifficultyInterval().toString(10).should.equal('2016');
    });

    it('get custom interval', function() {
      var chain = new Chain({
        targetTimespan: 30 * 60 * 1000
      });
      chain.getDifficultyInterval().toString(10).should.equal('3');
    });

  });

  describe('#buildGenesisBlock', function() {
    it('can handle no options', function() {
      var db = {
        buildGenesisData: sinon.stub().returns({})
      };
      var chain = new Chain({db: db});
      var block = chain.buildGenesisBlock();
      should.exist(block);
      block.should.be.instanceof(Block);
      db.buildGenesisData.calledOnce.should.equal(true);
    });

    it('set timestamp, nonce, bits, merkleRoot and data of the genesis', function() {
      var db = {
        buildGenesisData: sinon.stub().returns({
          merkleRoot: 'merkleRoot',
          buffer: new Buffer('abcdef', 'hex')
        })
      };
      var chain = new Chain({db: db});
      var timestamp = '2015-03-20T14:46:01.118Z';
      var block = chain.buildGenesisBlock({
        timestamp: timestamp,
        nonce: 1,
        bits: 520617984
      });
      should.exist(block);
      block.should.be.instanceof(Block);
      block.timestamp.toISOString().should.equal(timestamp);
      block.nonce.should.equal(1);
      block.bits.should.equal(520617984);
      block.merkleRoot.should.equal('merkleRoot');
      block.data.should.deep.equal(new Buffer('abcdef', 'hex'));
      db.buildGenesisData.calledOnce.should.equal(true);
    });

  });

  describe('#getRetargetedBits', function() {
    it('should get the correct bits', function() {
      var chain = new Chain();
      var bits = chain.getRetargetedBits(486604799, 12 * 24 * 60 * 60 * 1000);
      bits.should.equal(484142299);
    });
    it('should get the correct bits if actual timespan was really small', function() {
      var chain = new Chain();
      var bits1 = chain.getRetargetedBits(486604799, 2 * 24 * 60 * 60 * 1000);
      bits1.should.equal(473956288);
      var bits2 = chain.getRetargetedBits(486604799, 1 * 24 * 60 * 60 * 1000);
      bits2.should.equal(473956288);
    });
    it('should get the correct bits if actual timespan was really large', function() {
      var chain = new Chain();
      var bits1 = chain.getRetargetedBits(436567560, 60 * 24 * 60 * 60 * 1000);
      bits1.should.equal(437647392);
      var bits2 = chain.getRetargetedBits(436567560, 70 * 24 * 60 * 60 * 1000);
      bits2.should.equal(437647392);
    });
    it('should not give higher than max bits', function() {
      var chain = new Chain();
      var bits = chain.getRetargetedBits(486604799, 16 * 24 * 60 * 60 * 1000);
      bits.should.equal(486604799);
    });
  });

  describe('#getTargetFromBits/#getBitsFromTarget', function() {

    var target1;
    var target2;
    var target3;

    it('should calculate the target correctly', function() {
      var chain = new Chain();
      var target1 = chain.getTargetFromBits(0x1b0404cb);
      var expected = '00000000000404cb000000000000000000000000000000000000000000000000';
      target1.toString('hex', 32).should.equal(expected);
    });

    it('should error if bits is too small', function() {
      var chain = new Chain();
      (function(){
        var target1 = chain.getTargetFromBits(Chain.DEFAULTS.MIN_BITS - 1);
      }).should.throw('bits is too small');
    });

    it('should error if bits is too large', function() {
      var chain = new Chain();
      (function(){
        var target1 = chain.getTargetFromBits(Chain.DEFAULTS.MAX_BITS + 1);
      }).should.throw('bits is too big');
    });

    it('should get the bits', function() {
      var chain = new Chain();
      var expected = '00000000000404cb000000000000000000000000000000000000000000000000';
      var bits = chain.getBitsFromTarget(expected);
      bits.should.equal(0x1b0404cb);
    });

  });

  describe('#getDifficultyFromBits', function() {
    it('should return the correct difficulty', function() {
      var genesis = {bits: 0x1d00ffff};
      var chain = new Chain({genesis: genesis});

      var difficulty = chain.getDifficultyFromBits(0x1818bb87);
      difficulty.toString(10).should.equal('44455415962');
    });
  });

  describe('#getBlockWeight', function() {
    it('should return the correct block weight for normal targets', function(done) {
      var block = {bits: 0x1d00ffff};
      var db = {
        getBlock: sinon.stub().callsArgWith(1, null, block)
      };
      var chain = new Chain({db: db});
      chain.getBlockWeight(block, function(err, weight) {
        weight.toString(16).should.equal('100010001');
        done();
      });
    });
    it('should correctly report an error if it happens', function(done) {
      var block = {bits: 0x1d00ffff};
      var db = {
        getBlock: sinon.stub().callsArgWith(1, new Error('fake error'))
      };
      var chain = new Chain({db: db});
      chain.getBlockWeight(block, function(err, weight) {
        should.exist(err);
        err.message.should.equal('fake error');
        done();
      });
    });
    it('should correctly report an error for a null block', function(done) {
      var block = {bits: 0x1d00ffff};
      var db = {
        getBlock: sinon.stub().callsArgWith(1, null, null)
      };
      var chain = new Chain({db: db});
      chain.getBlockWeight(block, function(err, weight) {
        should.exist(err);
        err.message.should.match(/Block not found/);
        done();
      });
    });
  });

  describe('Bitcoin POW', function() {
    it('should calculate correct difficulty for block 201600', function(done) {
      var chain = new Chain();
      var beginBlock = {
        timestamp: new Date(1348092851000),
        bits: 436591499
      };
      var lastBlock = {
        timestamp: new Date(1349227021000),
        bits: 436591499
      };
      chain.getHeightForBlock = sinon.stub().callsArgWith(1, null, 201599);
      chain.getBlockAtHeight = sinon.stub().callsArgWith(2, null, beginBlock);
      chain.getNextWorkRequired(lastBlock, function(err, bits) {
        should.not.exist(err);
        bits.should.equal(436567560);
        done();
      });
    });
  });
});
