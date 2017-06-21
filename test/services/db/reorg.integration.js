'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var DB = require('../../../lib/services/db');
var Sync = require('../../../lib/services/db/sync.js');
var Networks = bitcore.Networks;
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var blocks = require('../../data/blocks.json');


describe('DB', function() {

  var bitcoind = {
    on: function(event, callback) {
      console.log('event', event);
    },
    genesisBuffer: blocks.genesis,
    tiphash: '2e516187b1b58467cb138bf68ff00d9bda71b5487cdd7b9b9cfbe7b153cd59d4',
    height: 2,
    getBlock: function(heightHash, callback) {
      var self = this;
      setImmediate(function() {
        switch(heightHash) {
          case 0:
            return callback(null, bitcore.Block.fromString(blocks.genesis));
          case 1:
            return callback(null, bitcore.Block.fromString(blocks.block1a));
          case 2:
            return callback(null, bitcore.Block.fromString(blocks.block2b));
          case '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206':
            return callback(null, bitcore.Block.fromString(blocks.genesis));
          case '77d0b8043d3a1353ffd22ad70e228e30c15fd0f250d51d608b1b7997e6239ffb':
            return callback(null, bitcore.Block.fromString(blocks.block1a));
          case '2e516187b1b58467cb138bf68ff00d9bda71b5487cdd7b9b9cfbe7b153cd59d4':
            return callback(null, bitcore.Block.fromString(blocks.block1b));
          case 'a0eadacf7ac5d613edea275ad1f3375689cd025f97b2fc73a27d04f745c46996':
            return callback(null, bitcore.Block.fromString(blocks.block2b));
          default:
            return callback(new Error('height/hash out of range'));
        }
      });
    },
    getBlockHeader: function(hash, callback) {
      var self = this;
      setImmediate(function() {
        switch(hash) {
          case '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206':
            // genesis
            return callback(null, null);
          case '77d0b8043d3a1353ffd22ad70e228e30c15fd0f250d51d608b1b7997e6239ffb':
            // 1a
            return callback(null, {
              prevHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
            });
          case '2e516187b1b58467cb138bf68ff00d9bda71b5487cdd7b9b9cfbe7b153cd59d4':
            // 1b
            return callback(null, {
              prevHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
            });
          case 'a0eadacf7ac5d613edea275ad1f3375689cd025f97b2fc73a27d04f745c46996':
            // 2b
            return callback(null, {
              prevHash: '2e516187b1b58467cb138bf68ff00d9bda71b5487cdd7b9b9cfbe7b153cd59d4'
            });
        }
      });
    }
  };

  var node = {
    network: Networks.testnet,
    datadir: '/tmp/datadir',
    services: { bitcoind: bitcoind },
    on: sinon.stub(),
    once: function(event, callback) {
      if(event === 'ready') {
        setImmediate(callback);
      }
    },
    openBus: sinon.stub()
  };

  before(function(done) {

    var self = this;

    sinon.stub(Sync.prototype, '_startSubscriptions');

    rimraf(node.datadir, function(err) {
      if(err) {
        return done(err);
      }
      mkdirp(node.datadir, done);
    });

    this.db = new DB({node: node});
    sinon.spy(this.db, 'printTipInfo');
    this.emitter = new EventEmitter();

  });

  after(function() {
    Sync.prototype._startSubscriptions.restore();
  });


  describe('Reorg', function() {
    it('should start db service', function(done) {
      this.db.start(function(err) {
        should.not.exist(err);
        done();
      });
    });

    it('should reorg successfully', function(done) {
      var self = this;

      this.db.on('synced', function() {
        self.db.printTipInfo.callCount.should.equal(2);
        self.db.printTipInfo.args[0][0].should.equal('Reorg detected!');
        self.db.printTipInfo.args[1][0].should.equal('Reorg successful!');
        done();
      })
    });

  });
});

