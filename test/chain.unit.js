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

  describe('#start', function() {
    it('should call the callback when base chain is initialized', function(done) {
      var chain = new Chain();
      chain.node = {};
      chain.node.bitcoind = {};
      chain.node.bitcoind.genesisBuffer = new Buffer('0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000', 'hex');
      chain.initialize = function() {
        chain.emit('initialized');
      };

      chain.start(done);
    });
  });

  describe('#stop', function() {
    it('should call the callback', function(done) {
      var chain = new Chain();
      chain.stop(done);
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

  describe('#getWeight', function() {
    var work = '000000000000000000000000000000000000000000005a7b3c42ea8b844374e9';
    var chain = new Chain();
    chain.db = {
      bitcoind: {
        getBlockIndex: sinon.stub().returns({
          chainWork: work
        })
      }
    };

    it('should give the weight as a BN', function(done) {
      chain.getWeight('hash', function(err, weight) {
        should.not.exist(err);
        weight.toString(16, 64).should.equal(work);
        done();
      });
    });

    it('should give an error if the weight is undefined', function(done) {
      chain.db.bitcoind.getBlockIndex = sinon.stub().returns(undefined);
      chain.getWeight('hash2', function(err, weight) {
        should.exist(err);
        done();
      });
    });
  });
});
