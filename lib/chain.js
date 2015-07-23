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

Chain.prototype.getWeight = function getWeight(blockHash, callback) {
  var self = this;
  var blockIndex = self.db.bitcoind.getBlockIndex(blockHash);

  setImmediate(function() {
    if (blockIndex) {
      callback(null, new BN(blockIndex.chainWork, 'hex'));
    } else {
      return callback(new Error('Weight not found for ' + blockHash));
    }
  });
};

module.exports = Chain;
