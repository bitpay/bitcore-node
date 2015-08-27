'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var bitcore = require('bitcore');
var BN = bitcore.crypto.BN;
var $ = bitcore.util.preconditions;
var Block = bitcore.Block;
var index = require('./index');
var log = index.log;
var utils = require('./utils');

var MAX_STACK_DEPTH = 1000;

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
function Chain(opts) {
  /* jshint maxstatements: 30 */
  if (!(this instanceof Chain)) {
    return new Chain(opts);
  }

  var self = this;
  if(!opts) {
    opts = {};
  }

  this.genesis = opts.genesis;
  this.genesisOptions = opts.genesisOptions;
  this.genesisWeight = new BN(0);
  this.tip = null;
  this.overrideTip = opts.overrideTip;
  this.cache = {
    hashes: {}, // dictionary of hash -> prevHash
    chainHashes: {}
  };
  this.lastSavedMetadata = null;
  this.lastSavedMetadataThreshold = 0; // Set this during syncing for faster performance
  this.blockQueue = [];
  this.processingBlockQueue = false;
  this.builder = opts.builder || false;
  this.ready = false;

  this.on('initialized', function() {
    self.initialized = true;
  });

  this.on('initialized', this._onInitialized.bind(this));

  this.on('ready', function() {
    log.debug('Chain is ready');
    self.ready = true;
    self.startBuilder();
  });

  this.minBits = opts.minBits || Chain.DEFAULTS.MIN_BITS;
  this.maxBits = opts.maxBits || Chain.DEFAULTS.MAX_BITS;

  this.maxHashes = opts.maxHashes || Chain.DEFAULTS.MAX_HASHES;

  this.targetTimespan = opts.targetTimespan || Chain.DEFAULTS.TARGET_TIMESPAN;
  this.targetSpacing = opts.targetSpacing || Chain.DEFAULTS.TARGET_SPACING;

  this.node = opts.node;

  return this;
}

util.inherits(Chain, EventEmitter);

Chain.DEFAULTS = {
  MAX_HASHES: new BN('10000000000000000000000000000000000000000000000000000000000000000', 'hex'),
  TARGET_TIMESPAN: 14 * 24 * 60 * 60 * 1000, // two weeks
  TARGET_SPACING: 10 * 60 * 1000, // ten minutes
  MAX_BITS: 0x1d00ffff,
  MIN_BITS: 0x03000000
};

Chain.prototype._onInitialized = function() {
  this.emit('ready');
};

Chain.prototype.start = function(callback) {
  this.genesis = Block.fromBuffer(this.node.bitcoind.genesisBuffer);
  this.once('initialized', callback);
  this.initialize();
};

Chain.prototype.initialize = function() {
  var self = this;

  // Does our database already have a tip?
  self.node.db.getMetadata(function getMetadataCallback(err, metadata) {
    if(err) {
      return self.emit('error', err);
    } else if(!metadata || !metadata.tip) {
      self.tip = self.genesis;
      self.tip.__height = 0;
      self.tip.__weight = self.genesisWeight;
      self.node.db.putBlock(self.genesis, function putBlockCallback(err) {
        if(err) {
          return self.emit('error', err);
        }
        self.node.db._onChainAddBlock(self.genesis, function(err) {
          if(err) {
            return self.emit('error', err);
          }

          self.emit('addblock', self.genesis);
          self.saveMetadata();
          self.emit('initialized');
        });
      });
    } else {
      metadata.tip = metadata.tip;
      self.node.db.getBlock(metadata.tip, function getBlockCallback(err, tip) {
        if(err) {
          return self.emit('error', err);
        }

        self.tip = tip;
        self.tip.__height = metadata.tipHeight;
        self.tip.__weight = new BN(metadata.tipWeight, 'hex');
        self.cache = metadata.cache;
        self.emit('initialized');
      });
    }
  });
};

Chain.prototype.stop = function(callback) {
  setImmediate(callback);
};

Chain.prototype._validateBlock = function(block, callback) {
  // All validation is done by bitcoind
  setImmediate(callback);
};

Chain.prototype.startBuilder = function() {
  // Unused in bitcoind.js
};

Chain.prototype.getWeight = function getWeight(blockHash, callback) {
  var self = this;
  var blockIndex = self.node.bitcoind.getBlockIndex(blockHash);

  setImmediate(function() {
    if (blockIndex) {
      callback(null, new BN(blockIndex.chainWork, 'hex'));
    } else {
      return callback(new Error('Weight not found for ' + blockHash));
    }
  });
};

/**
 * Will get an array of hashes all the way to the genesis block for
 * the chain based on "block hash" as the tip.
 *
 * @param {String} block hash - a block hash
 * @param {Function} callback - A function that accepts: Error and Array of hashes
 */
Chain.prototype.getHashes = function getHashes(tipHash, callback) {
  var self = this;

  $.checkArgument(utils.isHash(tipHash));

  var hashes = [];
  var depth = 0;

  getHashAndContinue(null, tipHash);

  function getHashAndContinue(err, hash) {
    if (err) {
      return callback(err);
    }

    depth++;

    hashes.unshift(hash);

    if (hash === self.genesis.hash) {
      // Stop at the genesis block
      self.cache.chainHashes[tipHash] = hashes;
      callback(null, hashes);
    } else if(self.cache.chainHashes[hash]) {
      hashes.shift();
      hashes = self.cache.chainHashes[hash].concat(hashes);
      delete self.cache.chainHashes[hash];
      self.cache.chainHashes[tipHash] = hashes;
      callback(null, hashes);
    } else {
      // Continue with the previous hash
      // check cache first
      var prevHash = self.cache.hashes[hash];
      if(prevHash) {
        // Don't let the stack get too deep. Otherwise we will crash.
        if(depth >= MAX_STACK_DEPTH) {
          depth = 0;
          return setImmediate(function() {
            getHashAndContinue(null, prevHash);
          });
        } else {
          return getHashAndContinue(null, prevHash);
        }
      } else {
        // do a db call if we don't have it
        self.node.db.getPrevHash(hash, function(err, prevHash) {
          if(err) {
            return callback(err);
          }

          return getHashAndContinue(null, prevHash);
        });
      }
    }
  }

};

Chain.prototype.saveMetadata = function saveMetadata(callback) {
  var self = this;

  callback = callback || function() {};

  if(self.lastSavedMetadata && Date.now() < self.lastSavedMetadata.getTime() + self.lastSavedMetadataThreshold) {
    return callback();
  }

  var metadata = {
    tip: self.tip ? self.tip.hash : null,
    tipHeight: self.tip && self.tip.__height ? self.tip.__height : 0,
    tipWeight: self.tip && self.tip.__weight ? self.tip.__weight.toString(16) : '0',
    cache: self.cache
  };

  self.lastSavedMetadata = new Date();

  self.node.db.putMetadata(metadata, callback);
};

module.exports = Chain;
