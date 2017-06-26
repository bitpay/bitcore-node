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

});


