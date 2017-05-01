'use strict';

var expect = require('chai').expect;
var bitcore = require('bitcore-lib');
var DB = require('../../../lib/services/db');

describe('DB', function() {

  describe('Reorg', function() {

    before(function() {
      this.db = new DB({
        node: {
          network: bitcore.Networks.testnet,
          datadir: '/tmp',
          services: ''
        }
      });
      this.db.tip = { hash: 'ff', height: 444 };
    });

    it('should detect a reorg from a common ancenstor that is in our set', function() {
      var block1 = { hash: '11', header: { prevHash: new Buffer('ff', 'hex') } };
      var block2 = { hash: '22', header: { prevHash: new Buffer('11', 'hex') } };
      var block3 = { hash: '33', header: { prevHash: new Buffer('22', 'hex') } };
      var block4 = { hash: '44', header: { prevHash: new Buffer('22', 'hex') } };
      //blocks must be passed in the order that they are received.
      var blocks = [ block3, block2, block1, block4 ];
      expect(this.db.detectReorg(blocks)).to.deep.equal(block3);

    });

    it('should detect a reorg from a common ancenstor that is not in our set', function() {
      var block1 = { hash: '11', header: { prevHash: new Buffer('ff', 'hex') } };
      var block2 = { hash: '22', header: { prevHash: new Buffer('11', 'hex') } };
      var block3 = { hash: '33', header: { prevHash: new Buffer('22', 'hex') } };
      var block4 = { hash: '44', header: { prevHash: new Buffer('ee', 'hex') } };
      var blocks = [ block3, block2, block1, block4 ];
      expect(this.db.detectReorg(blocks)).to.deep.equal(block4);

    });

    it('should not detect a reorg', function() {
      this.db.reorgTipHash = null;
      var block1 = { hash: '11', header: { prevHash: new Buffer('ff', 'hex') } };
      var block2 = { hash: '22', header: { prevHash: new Buffer('11', 'hex') } };
      var block3 = { hash: '33', header: { prevHash: new Buffer('22', 'hex') } };
      var block4 = { hash: '44', header: { prevHash: new Buffer('33', 'hex') } };
      var blocks = [ block3, block2, block1, block4 ];
      var actual = this.db.detectReorg(blocks);
      expect(actual).to.be.undefined;
    });

  });
});

