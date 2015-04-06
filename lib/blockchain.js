'use strict';

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;

function BlockChain() {
  this.tip = null;
  this.headers = {};
  this.next = {};
  this.prev = {};
}

BlockChain.fromObject = function(obj) {
  var blockchain = new BlockChain();
  blockchain.tip = obj.tip;
  blockchain.headers = obj.headers;
  blockchain.next = obj.next;
  blockchain.prev = obj.prev;
  return blockchain;
};

BlockChain.prototype.setTip = function(block) {
  $.checkArgument(block instanceof bitcore.Block, 'Argument is not a Block instance');
  this.tip = block.hash;
  this.headers[block.hash] = block.header;
  var prevHash = bitcore.util.buffer.reverse(block.header.prevHash).toString('hex');
  this.next[prevHash] = block.hash;
  this.prev[block.hash] = prevHash;
};

BlockChain.prototype.toObject = function() {
  return {
    tip: this.tip,
    headers: _.map(this.headers, function(header) { return header.toObject(); }),
    next: this.next,
    prev: this.prev
  };
};

BlockChain.prototype.toJSON = function() {
  return JSON.stringify(this.toObject());
};

module.exports = BlockChain;
