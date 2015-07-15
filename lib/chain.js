'use strict';

var util = require('util');
var bitcore = require('bitcore');
var chainlib = require('chainlib');
var BaseChain = chainlib.Chain;
var BN = bitcore.crypto.BN;
var Block = require('./block');

Chain.DEFAULTS = {
  MAX_HASHES: new BN('10000000000000000000000000000000000000000000000000000000000000000', 'hex'),
  TARGET_TIMESPAN: 14 * 24 * 60 * 60 * 1000, // two weeks
  TARGET_SPACING: 10 * 60 * 1000, // ten minutes
  MAX_BITS: 0x1d00ffff,
  MIN_BITS: 0x03000000
};

/**
 * Will instantiate a new Chain instance
 * @param {Object} options - The options for the chain
 * @param {Number} options.minBits - The minimum number of bits
 * @param {Number} options.maxBits - The maximum number of bits
 * @param {BN|Number} options.targetTimespan - The number of milliseconds for difficulty retargeting
 * @param {BN|Number} options.targetSpacing - The number of milliseconds between blocks
 * @returns {Chain}
 * @extends BaseChain
 * @constructor
 */
function Chain(options) {
  /* jshint maxstatements: 20 */
  /* jshint maxcomplexity: 12 */
  if (!(this instanceof Chain)) {
    return new Chain(options);
  }
  if (!options) {
    options = {};
  }
  BaseChain.call(this, options);

  this.minBits = options.minBits || Chain.DEFAULTS.MIN_BITS;
  this.maxBits = options.maxBits || Chain.DEFAULTS.MAX_BITS;

  this.maxHashes = options.maxHashes || Chain.DEFAULTS.MAX_HASHES;

  this.targetTimespan = options.targetTimespan || Chain.DEFAULTS.TARGET_TIMESPAN;
  this.targetSpacing = options.targetSpacing || Chain.DEFAULTS.TARGET_SPACING;

  return this;
}

util.inherits(Chain, BaseChain);

Chain.prototype._writeBlock = function(block, callback) {
  // Update hashes
  this.cache.hashes[block.hash] = block.prevHash;
  // call db.putBlock to update prevHash index, but it won't write the block to disk
  this.db.putBlock(block, callback);
};

Chain.prototype._validateBlock = function(block, callback) {
  // All validation is done by bitcoind
  setImmediate(callback);
};

Chain.prototype.startBuilder = function() {
  // Unused in bitcoind.js
};

Chain.prototype.buildGenesisBlock = function buildGenesisBlock(options) {
  if (!options) {
    options = {};
  }
  var genesis = new Block({
    prevHash: null,
    height: 0,
    timestamp: options.timestamp || new Date(),
    nonce: options.nonce || 0,
    bits: options.bits || this.maxBits
  });
  var data = this.db.buildGenesisData();
  genesis.merkleRoot = data.merkleRoot;
  genesis.data = data.buffer;
  return genesis;
};

/**
 * Calculates the number of blocks for a retargeting interval
 * @returns {BN}
 */
Chain.prototype.getDifficultyInterval = function getDifficultyInterval() {
  return this.targetTimespan / this.targetSpacing;
};

/**
 * Will recalculate the bits based on the hash rate of the previous interval
 * @see https://en.bitcoin.it/wiki/Difficulty#How_is_difficulty_stored_in_blocks.3F
 * @param {Number} bits - The bits of the previous interval block
 * @param {Number} timespan - The number of milliseconds that elapsed in the last interval
 * @returns {Number} The compacted target in bits
 */
Chain.prototype.getRetargetedBits = function getRetargetedBits(bits, timespan) {
  // Based off Bitcoin's code:
  // https://github.com/bitcoin/bitcoin/blob/master/src/pow.cpp#L53

  if(timespan < this.targetTimespan / 4) {
    timespan = Math.floor(this.targetTimespan / 4);
  } else if(timespan > this.targetTimespan * 4) {
    timespan = this.targetTimespan * 4;
  }

  var oldTarget = this.getTargetFromBits(bits);
  var newTarget = oldTarget.mul(new BN(timespan, 10)).div(new BN(this.targetTimespan, 10));
  var newBits = this.getBitsFromTarget(newTarget);

  if(newBits > this.maxBits) {
    newBits = this.maxBits;
  }

  return newBits;
};

/**
 * Calculates the number of blocks for a retargeting interval
 * @param {Block} - block - An instance of a block
 * @param {Function} - callback - A callback function that accepts arguments: Error and Number
 */
Chain.prototype.getNextWorkRequired = function getNextWorkRequired(block, callback) {

  var self = this;

  var interval = this.getDifficultyInterval();

  self.getHeightForBlock(block.hash, function(err, height) {

    if (err) {
      return callback(err);
    }

    if (height === 0) {
      return callback(null, self.maxBits);
    }

    // not on interval, return the same amount of difficulty
    if ((height + 1) % interval !== 0) {
      return callback(null, block.bits);
    }

    // otherwise compute the new difficulty
    self.getBlockAtHeight(block, height + 1 - interval, function(err, lastIntervalBlock){
      if (err) {
        callback(err);
      }

      var timespan = (Math.floor(block.timestamp.getTime() / 1000) * 1000) - (Math.floor(lastIntervalBlock.timestamp.getTime() / 1000) * 1000);
      var bits = self.getRetargetedBits(lastIntervalBlock.bits, timespan);

      return callback(null, bits);

    });

  });

};

/**
 * Calculates the actual target from the compact form
 * @param {Number} - bits
 * @returns {BN}
 */
Chain.prototype.getTargetFromBits = function getTargetFromBits(bits) {
  if(bits <= this.minBits) {
    throw new Error('bits is too small (' + bits + ')');
  }

  if(bits > this.maxBits) {
    throw new Error('bits is too big (' + bits + ')');
  }

  var a = bits & 0xffffff;
  var b = bits >>> 24;

  var exp = (8 * (b - 3));

  // Exponents via bit shift (works for powers of 2)
  var z = (new BN(2, 10)).shln(exp - 1);
  var target = (new BN(a, 10)).mul(z);

  return target;

};

/**
 * Calculates the compact target "bits" from the target
 * @param {BN|Number} - target
 * @returns {Number}
 */
Chain.prototype.getBitsFromTarget = function getBitsFromTarget(target) {
  target = new BN(target, 'hex');

  var tmp = target;

  var b = 0;
  while(tmp.cmp(new BN(0, 10)) > 0) {
    b++;
    tmp = tmp.shrn(8);
  }

  var a = target.shrn((b - 3) * 8);
  var bits = Number('0x' + b.toString(16) + a.toString(16, 6));
  return bits;
};

Chain.prototype.getDifficultyFromBits = function getDifficultyFromBits(bits) {
  var currentTarget = this.getTargetFromBits(bits);
  var genesisTarget = this.getTargetFromBits(this.genesis.bits);
  return genesisTarget.div(currentTarget);
};

Chain.prototype.getBlockWeight = function getBlockWeight(blockHash, callback) {
  var self = this;

  self.db.getBlock(blockHash, function(err, block) {
    if(err) {
      return callback(err);
    } else if(!block) {
      return callback(new Error('Block not found (' + blockHash + ')'));
    }

    var target = self.getTargetFromBits(block.bits);
    var a = self.maxHashes.sub(target).sub(new BN(1, 10));
    var b = target.add(new BN(1, 10));
    var c = a.div(b);
    var d = c.add(new BN(1, 10));
    return callback(null, d);
  });
};

module.exports = Chain;
