'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
var memdown = require('memdown');

var index = require('../');
var DB = index.DB;
var Chain = index.Chain;
var bitcore = require('bitcore');
var BufferUtil = bitcore.util.buffer;
var Block = bitcore.Block;
var BN = bitcore.crypto.BN;

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
      chain.node.modules = {};
      chain.node.modules.bitcoind = {};
      chain.node.modules.bitcoind.genesisBuffer = new Buffer('0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000', 'hex');
      chain.initialize = function() {
        chain.emit('initialized');
      };

      chain.start(done);
    });
  });

  describe('#initialize', function() {

    it('should initialize the chain with the genesis block if no metadata is found in the db', function(done) {
      var db = {};
      db.getMetadata = sinon.stub().callsArgWith(0, null, {});
      db.putMetadata = sinon.stub().callsArg(1);
      db.getTransactionsFromBlock = sinon.stub();
      db.connectBlock = sinon.stub().callsArg(1);
      db.mempool = {
        on: sinon.spy()
      };
      var node = {
        modules: {
          db: db
        }
      };
      var chain = new Chain({node: node, genesis: {hash: 'genesis'}});

      chain.on('ready', function() {
        should.exist(chain.tip);
        chain.tip.hash.should.equal('genesis');
        Number(chain.tip.__weight.toString(10)).should.equal(0);
        done();
      });
      chain.on('error', function(err) {
        should.not.exist(err);
        done();
      });

      chain.initialize();
    });

    it('should initialize the chain with the metadata from the database if it exists', function(done) {
      var db = {};
      db.getMetadata = sinon.stub().callsArgWith(0, null, {tip: 'block2', tipWeight: 2});
      db.putMetadata = sinon.stub().callsArg(1);
      db.getBlock = sinon.stub().callsArgWith(1, null, {hash: 'block2', prevHash: 'block1'});
      db.getTransactionsFromBlock = sinon.stub();
      db.mempool = {
        on: sinon.spy()
      };
      var node = {
        modules: {
          db: db
        }
      };
      var chain = new Chain({node: node, genesis: {hash: 'genesis'}});
      chain.getHeightForBlock = sinon.stub().callsArgWith(1, null, 10);
      chain.getWeight = sinon.stub().callsArgWith(1, null, new BN(50));
      chain.on('ready', function() {
        should.exist(chain.tip);
        chain.tip.hash.should.equal('block2');
        done();
      });
      chain.on('error', function(err) {
        should.not.exist(err);
        done();
      });
      chain.initialize();
    });

    it('emit error from getMetadata', function(done) {
      var db = {
        getMetadata: function(cb) {
          cb(new Error('getMetadataError'));
        }
      };
      db.getTransactionsFromBlock = sinon.stub();
      db.mempool = {
        on: sinon.spy()
      };
      var node = {
        modules: {
          db: db
        }
      };
      var chain = new Chain({node: node, genesis: {hash: 'genesis'}});
      chain.on('error', function(error) {
        should.exist(error);
        error.message.should.equal('getMetadataError');
        done();
      });
      chain.initialize();
    });

    it('emit error from getBlock', function(done) {
      var db = {
        getMetadata: function(cb) {
          cb(null, {tip: 'tip'});
        },
        getBlock: function(tip, cb) {
          cb(new Error('getBlockError'));
        }
      };
      db.getTransactionsFromBlock = sinon.stub();
      db.mempool = {
        on: sinon.spy()
      };
      var node = {
        modules: {
          db: db
        }
      };
      var chain = new Chain({node: node, genesis: {hash: 'genesis'}});
      chain.on('error', function(error) {
        should.exist(error);
        error.message.should.equal('getBlockError');
        done();
      });
      chain.initialize();
    });
  });

  describe('#stop', function() {
    it('should call the callback', function(done) {
      var chain = new Chain();
      chain.stop(done);
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

  describe('#getWeight', function() {
    var work = '000000000000000000000000000000000000000000005a7b3c42ea8b844374e9';
    var chain = new Chain();
    chain.node = {};
    chain.node.modules = {};
    chain.node.modules.db = {};
    chain.node.modules.bitcoind = {
      getBlockIndex: sinon.stub().returns({
        chainWork: work
      })
    };

    it('should give the weight as a BN', function(done) {
      chain.getWeight('hash', function(err, weight) {
        should.not.exist(err);
        weight.toString(16, 64).should.equal(work);
        done();
      });
    });

    it('should give an error if the weight is undefined', function(done) {
      chain.node.modules.bitcoind.getBlockIndex = sinon.stub().returns(undefined);
      chain.getWeight('hash2', function(err, weight) {
        should.exist(err);
        done();
      });
    });
  });

  describe('#getHashes', function() {

    it('should get an array of chain hashes', function(done) {

      var blocks = {};
      var genesisBlock = Block.fromBuffer(new Buffer(chainData[0], 'hex'));
      var block1 = Block.fromBuffer(new Buffer(chainData[1], 'hex'));
      var block2 = Block.fromBuffer(new Buffer(chainData[2], 'hex'));
      blocks[genesisBlock.hash] = genesisBlock;
      blocks[block1.hash] = block1;
      blocks[block2.hash] = block2;

      var db = {};
      db.getPrevHash = function(blockHash, cb) {
        // TODO: expose prevHash as a string from bitcore
        var prevHash = BufferUtil.reverse(blocks[blockHash].header.prevHash).toString('hex');
        cb(null, prevHash);
      };

      var node = {
        modules: {
          db: db
        }
      };

      var chain = new Chain({
        node: node,
        genesis: genesisBlock
      });

      chain.tip = block2;

      delete chain.cache.hashes[block1.hash];

      // the test
      chain.getHashes(block2.hash, function(err, hashes) {
        should.not.exist(err);
        should.exist(hashes);
        hashes.length.should.equal(3);
        done();
      });

    });
  });


});
