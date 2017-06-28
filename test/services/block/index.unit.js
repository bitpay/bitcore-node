'use strict';

var expect = require('chai').expect;
var BlockService = require('../../../lib/services/block');
var LRU = require('lru-cache');

describe('Block Service', function() {

  var blockService;

  beforeEach(function() {
    blockService = new BlockService({ node: { services: []}});
    blockService._chainTips = LRU(50);
  });


  describe('Chain Tips', function() {
    it('should merge blocks into chain tips using active chain blocks only' , function() {

      var blocks = ['aa','bb','cc','dd','ee'];

      blocks.forEach(function(n, index) {

        var buf = new Buffer('00', 'hex');
        if (index) {
          buf = new Buffer(blocks[index-1], 'hex');
        }

        var block = { header: { prevHash: buf }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });

      expect(blockService._chainTips.length).to.equal(1);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'cc', 'bb', 'aa', '00']);
    });

    it('should merge blocks into chain tips using out of order blocks' , function() {

      var blocks = ['ee','aa','bb','dd','cc'];
      var prevBlocks = ['dd','00','aa','cc','bb'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });


      expect(blockService._chainTips.length).to.equal(1);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'cc', 'bb', 'aa', '00']);
    });

    it('should merge blocks where there is a fork (a parent block has more than one child)' , function() {

      var blocks = ['aa','bb','cc','dd','ee'];
      var prevBlocks = ['00','aa','aa','cc','dd'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });

      expect(blockService._chainTips.length).to.equal(2);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'cc', 'aa', '00']);
      expect(blockService._chainTips.get('bb')).to.deep.equal(['aa', '00']);
    });

    it('should merge blocks where there is a fork (a parent block has more than one child) and blocks are received out of order' , function() {

      var blocks = ['cc','aa','bb','ee','dd'];
      var prevBlocks = ['aa','00','aa','dd','cc'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });


      expect(blockService._chainTips.length).to.equal(2);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'cc', 'aa', '00']);
      expect(blockService._chainTips.get('bb')).to.deep.equal(['aa', '00']);
    });

    it('should merge blocks where there is a three-way fork (a parent block has more than one child) and blocks are received out of order' , function() {

      var blocks = ['cc','aa','bb','ee','dd'];
      var prevBlocks = ['aa','00','aa','dd','aa'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });


      expect(blockService._chainTips.length).to.equal(3);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'aa', '00']);
      expect(blockService._chainTips.get('bb')).to.deep.equal(['aa', '00']);
      expect(blockService._chainTips.get('cc')).to.deep.equal(['aa', '00']);
    });

  });

  it('shoudd merge blocks where there is three-way fork and blocks are received in order.', function() {

      var blocks = ['aa','bb','cc','dd','ee'];
      var prevBlocks = ['00','aa','aa','aa','dd'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });


      expect(blockService._chainTips.length).to.equal(3);
      expect(blockService._chainTips.get('ee')).to.deep.equal(['dd', 'aa', '00']);
      expect(blockService._chainTips.get('bb')).to.deep.equal(['aa', '00']);
      expect(blockService._chainTips.get('cc')).to.deep.equal(['aa', '00']);
  });

  describe('Reorgs', function() {

    it('should find a common ancestor in the normal case', function() {

      var blocks = ['aa', 'bb', 'cc', 'dd'];
      var prevBlocks = ['00', 'aa', 'bb', 'bb'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });

      blockService.tip = { hash: 'cc', height: 3 };
      var commonAncestor = blockService._findCommonAncestor({ hash: 'dd' });
      expect(commonAncestor).to.equal('bb');

    });

    it('should find a common ancestor in the case where more than one block is built on an alternative chain before reorg is discovered', function() {

      // even though 'ee' is the tip on the alt chain, 'dd' was the last block to come in that was not an orphan block. So 'dd' was the first to allow
      // reorg validation
      var blocks = ['aa', 'bb', 'cc', 'ee', 'dd'];
      var prevBlocks = ['00', 'aa', 'bb', 'dd', 'bb'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });

      blockService.tip = { hash: 'cc', height: 3 };
      var commonAncestor = blockService._findCommonAncestor({ hash: 'dd' });
      expect(commonAncestor).to.equal('bb');

    });

  });

  describe('Send all unsent blocks from main chain', function() {

    it('should send all unsent blocks from the active/main chain', function() {
      var blocks = ['ee','aa','bb','dd','cc'];
      var prevBlocks = ['dd','00','aa','cc','bb'];

      blocks.forEach(function(n, index) {
        var block = { header: { prevHash: new Buffer(prevBlocks[index], 'hex') }, hash: n };
        blockService._mergeBlockIntoChainTips(block);
      });
    });

  });
});


