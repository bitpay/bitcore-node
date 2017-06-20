'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var Reorg = require('../../../lib/services/db/reorg');

describe('Reorg', function() {
  describe('full-test', function() {
    before(function() {
      sinon.stub(BufferUtil, 'reverse', function(input) {
        return {
          toString: function() {
            return input;
          }
        };
      });
    });

    after(function() {
      BufferUtil.reverse.restore();
    });

    it('should handle a reorg correctly', function(done) {
      var tipBlocks = [
        {hash: 'main0', header: {prevHash: null}},
        {hash: 'main1', header: {prevHash: 'main0'}},
        {hash: 'fork1', header: {prevHash: 'main1'}},
        {hash: 'fork2', header: {prevHash: 'fork1'}}
      ];

      var concurrentBlocks = [
        {hash: 'main0', header: {prevHash: null}},
        {hash: 'main1', header: {prevHash: 'main0'}},
        {hash: 'fork1', header: {prevHash: 'main1'}},
        {hash: 'fork2', header: {prevHash: 'fork1'}},
        {hash: 'fork3', header: {prevHash: 'fork2'}}
      ];

      var bitcoindBlocks = [
        {hash: 'main0', header: {prevHash: null}},
        {hash: 'main1', header: {prevHash: 'main0'}},
        {hash: 'main2', header: {prevHash: 'main1'}},
        {hash: 'main3', header: {prevHash: 'main2'}}
      ];

      var allBlocks = tipBlocks.concat(concurrentBlocks, bitcoindBlocks);

      var db = {
        tip: tipBlocks[3],
        concurrentTip: concurrentBlocks[4],
        batch: sinon.stub().callsArg(1),
        getConcurrentBlockOperations: sinon.stub().callsArgWith(2, null, []),
        getSerialBlockOperations: sinon.stub().callsArgWith(2, null, []),
        getConcurrentTipOperation: sinon.stub().returns(null),
        getTipOperation: sinon.stub().returns(null)
      };

      var node = {
        services: {
          bitcoind: {
            getBlock: function(hash, callback) {
              var block;
              for(var i = 0; i < allBlocks.length; i++) {
                if(allBlocks[i].hash === hash) {
                  block = allBlocks[i];
                }
              }

              setImmediate(function() {
                if(!block) {
                  return callback(new Error('Block not found: ' + hash));
                }

                callback(null, block);
              });
            },
            getBlockHeader: function(hash, callback) {
              var header;
              for(var i = 0; i < allBlocks.length; i++) {
                if(allBlocks[i].hash === hash) {
                  header = allBlocks[i].header;
                }
              }

              setImmediate(function() {
                if(!header) {
                  return callback(new Error('Block header not found: ' + hash));
                }

                callback(null, header);
              });
            }
          }
        }
      };

      var reorg = new Reorg(node, db);

      reorg.handleReorg(bitcoindBlocks[3].hash, function(err) {
        should.not.exist(err);

        db.tip.hash.should.equal('main3');
        db.concurrentTip.hash.should.equal('main3');

        db.getConcurrentBlockOperations.callCount.should.equal(5);
        db.getConcurrentBlockOperations.args[0][0].should.equal(concurrentBlocks[4]);
        db.getConcurrentBlockOperations.args[0][1].should.equal(false);
        db.getConcurrentBlockOperations.args[1][0].should.equal(concurrentBlocks[3]);
        db.getConcurrentBlockOperations.args[1][1].should.equal(false);
        db.getConcurrentBlockOperations.args[2][0].should.equal(concurrentBlocks[2]);
        db.getConcurrentBlockOperations.args[2][1].should.equal(false);
        db.getConcurrentBlockOperations.args[3][0].should.equal(bitcoindBlocks[2]);
        db.getConcurrentBlockOperations.args[3][1].should.equal(true);
        db.getConcurrentBlockOperations.args[4][0].should.equal(bitcoindBlocks[3]);
        db.getConcurrentBlockOperations.args[4][1].should.equal(true);

        db.getSerialBlockOperations.callCount.should.equal(4);
        db.getSerialBlockOperations.args[0][0].should.deep.equal(tipBlocks[3]);
        db.getSerialBlockOperations.args[0][1].should.equal(false);
        db.getSerialBlockOperations.args[1][0].should.deep.equal(tipBlocks[2]);
        db.getSerialBlockOperations.args[1][1].should.equal(false);
        db.getSerialBlockOperations.args[2][0].should.deep.equal(bitcoindBlocks[2]);
        db.getSerialBlockOperations.args[2][1].should.equal(true);
        db.getSerialBlockOperations.args[3][0].should.deep.equal(bitcoindBlocks[3]);
        db.getSerialBlockOperations.args[3][1].should.equal(true);

        done();
      });
    });
  });
});
