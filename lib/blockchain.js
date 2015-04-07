'use strict';

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;

function BlockChain() {
  this.tip = '0000000000000000000000000000000000000000000000000000000000000000';
  this.work = {
    '0000000000000000000000000000000000000000000000000000000000000000': 0
  };
  this.height = {
    '0000000000000000000000000000000000000000000000000000000000000000': -1
  };
  this.hashByHeight = {
    '-1': '0000000000000000000000000000000000000000000000000000000000000000'
  };
  this.next = {};
  this.prev = {};
}

BlockChain.fromObject = function(obj) {
  var blockchain = new BlockChain();
  blockchain.tip = obj.tip;
  blockchain.work = obj.work;
  blockchain.hashByHeight = obj.hashByHeight;
  blockchain.height = obj.height;
  blockchain.next = obj.next;
  blockchain.prev = obj.prev;
  return blockchain;
};

var getWork = function(bits) {
  var bytes = ((bits >>> 24) & 0xff) >>> 0;
  return ((bits & 0xffffff) << (8 * (bytes - 3))) >>> 0;
};

BlockChain.prototype.addData = function(block) {
  $.checkArgument(block instanceof bitcore.Block, 'Argument is not a Block instance');

  var prevHash = bitcore.util.buffer.reverse(block.header.prevHash).toString('hex');

  this.work[block.hash] = this.work[prevHash].work + getWork(block.header.bits);
  this.prev[block.hash] = prevHash;
};

BlockChain.prototype.proposeNewBlock = function(block) {
  $.checkArgument(block instanceof bitcore.Block, 'Argument is not a Block instance');
  var prevHash = bitcore.util.buffer.reverse(block.header.prevHash).toString('hex');

  if (_.isUndefined(this.work[prevHash])) {
    throw new Error('No previous data to estimate work');
  }
  this.addData(block);

  if (this.work[block.hash] > this.work[this.tip]) {

    var toUnconfirm = [];
    var toConfirm = [];
    var commonAncestor;

    var pointer = block.hash;
    while (!this.height[pointer]) {
      toConfirm.push(pointer);
      pointer = this.prev[pointer];
    }
    commonAncestor = pointer;

    pointer = this.tip;
    while (pointer !== commonAncestor) {
      toUnconfirm.push(pointer);
      pointer = this.prev[pointer];
    }

    toConfirm.reverse();

    var self = this;
    toUnconfirm.map(function(hash) {
      self.unconfirm(hash);
    });
    toConfirm.map(function(hash) {
      self.confirm(hash);
    });
    return {
      unconfirmed: toUnconfirm,
      confirmed: toConfirm
    };
  }
  return {
    unconfirmed: [],
    confirmed: []
  };
};

BlockChain.prototype.confirm = function(hash) {
  var prevHash = this.prev[hash];
  $.checkState(prevHash === this.tip);

  this.tip = hash;
  var height = this.height[prevHash] + 1;
  this.next[prevHash] = hash;
  this.hashByHeight[height] = hash;
  this.height[hash] = height;
};

BlockChain.prototype.unconfirm = function(hash) {
  var prevHash = this.prev[hash];
  $.checkState(hash === this.tip);

  this.tip = prevHash;
  var height = this.height[hash];
  delete this.next[prevHash];
  delete this.hashByHeight[height];
  delete this.height[hash];
};

BlockChain.prototype.getBlockLocator = function() {
  $.checkState(this.tip);
  $.checkState(this.height[this.tip]);

  var result = [];
  var currentHeight = this.height[this.tip];
  var exponentialBackOff = 1;
  for (var i = 0; i < 10; i++) {
    if (currentHeight >= 0) {
      result.push(this.hashByHeight[currentHeight--]);
    }
  }
  while (currentHeight > 0) {
    result.push(this.hashByHeight[currentHeight]);
    currentHeight -= exponentialBackOff;
    exponentialBackOff *= 2;
  }
  return result;
};

BlockChain.prototype.hasData = function(hash) {
  return !!this.prev[hash];
};

BlockChain.prototype.prune = function() {
  var self = this;
  _.each(this.prev, function(key, value) {
    if (!self.height[key]) {
      delete this.prev[key];
      delete this.work[key];
    }
  });
};

BlockChain.prototype.toObject = function() {
  return {
    tip: this.tip,
    work: this.work,
    next: this.next,
    hashByHeight: this.hashByHeight,
    height: this.height,
    prev: this.prev
  };
};

BlockChain.prototype.toJSON = function() {
  return JSON.stringify(this.toObject());
};

module.exports = BlockChain;
