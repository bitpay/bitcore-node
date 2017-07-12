'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var LRU = require('lru-cache');
var utils = require('../../utils');
var _ = require('lodash');
var assert = require('assert');
var BN = require('bn.js');
var consensus = require('bcoin').consensus;
var constants = require('../../constants');

var BlockService = function(options) {
  BaseService.call(this, options);
  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._subscriptions = {};
  this._subscriptions.block = [];
  this._subscriptions.reorg = [];

  // meta is [{ chainwork: chainwork, hash: hash }]
  this._meta = []; // properties that apply to blocks that are not already stored on the blocks, yet we still needed, i.e. chainwork, height

  this._blockQueue = LRU({
    max: 50 * (1 * 1024 * 1024), // 50 MB of blocks,
    length: function(n) {
      return n.toBuffer().length;
    }
  }); // hash -> block

  this._chainTips = []; // list of all chain tips, including main chain and any chains that were orphaned after a reorg
  this._blockCount = 0;
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];

};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'p2p', 'db' ];

BlockService.MAX_CHAINWORK = new BN(1).ushln(256);
BlockService.MAX_BLOCKS = 500;

// --- public prototype functions
BlockService.prototype.start = function(callback) {

  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self._encoding = new Encoding(self.prefix);
    self._loadMeta();
    self._setListeners();
    callback();
  });

};

BlockService.prototype.stop = function(callback) {
  this._saveMetaData();
  callback();
};

BlockService.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getRawBlock', this, this.getRawBlock, 1],
    ['getBlockHeader', this, this.getBlockHeader, 1],
    ['getBlockOverview', this, this.getBlockOverview, 1],
    ['getBlockHashesByTimestamp', this, this.getBlockHashesByTimestamp, 2],
    ['getBestBlockHash', this, this.getBestBlockHash, 0]
  ];
  return methods;
};

BlockService.prototype.getPublishEvents = function() {

  return [
    {
      name: 'block/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    },
    {
      name: 'block/reorg',
      scope: this,
      subscribe: this.subscribe.bind(this, 'reorg'),
      unsubscribe: this.unsubscribe.bind(this, 'reorg')
    }
  ];

};

BlockService.prototype.subscribe = function(name, emitter) {

  this._subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'block/' + name, 'total:', this._subscriptions[name].length);

};

BlockService.prototype.unsubscribe = function(name, emitter) {

  var index = this._subscriptions[name].indexOf(emitter);

  if (index > -1) {
    this._subscriptions[name].splice(index, 1);
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'block/' + name, 'total:', this._subscriptions[name].length);

};

// --- start private prototype functions

BlockService.prototype._blockAlreadyProcessed = function(block) {

  return this._blockQueue.get(block.hash) ? true : false;

};

BlockService.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

BlockService.prototype._cacheBlock = function(block) {

  log.debug('Setting block: "' + block.hash + '" in the block cache.');

  // 1. set the block queue, which holds full blocks in memory
  this._blockQueue.set(block.hash, block);

  // 2. store the block in the database
  var operations = this._getBlockOperations(block);

  this._db.batch(operations, function(err) {

    if(err) {
      log.error('There was an error attempting to save block for hash: ' + block.hash);
      this._db.emit('error', err);
      return;
    }

    log.debug('Success saving block hash ' + block.hash);
  });

};

BlockService.prototype._computeChainwork = function(bits, prev) {

  var target = consensus.fromCompact(bits);

  if (target.isNeg() || target.cmpn(0) === 0) {
    return new BN(0);
  }

  var proof =  BlockService.MAX_CHAINWORK.div(target.iaddn(1));

  if (!prev) {
    return proof;
  }

  return proof.iadd(prev);

};

BlockService.prototype._determineBlockState = function(block) {

  if (this._isOrphanBlock(block)) {
    return 'orphaned';
  }

  if (this._isChainReorganizing(block)) {
    return 'reorg';
  }

  return 'normal';

};

BlockService.prototype._findCommonAncestor = function(block) {

  assert(this._chainTips.length > 1,
    'chain tips collection should have at least 2 chains in order to find a common ancestor.');

  var _oldTip = this._tip.hash;
  var _newTip = block.hash;

  assert(_newTip && _oldTip, 'current chain and/or new chain do not exist in our list of chain tips.');

  var len = this._blockQueue.itemCount;
  for(var i = 0; i < len; i++) {

    var oldBlk = this._blockQueue.get(_oldTip);
    var newBlk = this._blockQueue.get(_newTip);

    if (!oldBlk || !newBlk) {
      return;
    }

    _oldTip = oldBlk.prevHash;
    _newTip = newBlk.prevHash;

    if (_newTip === _oldTip) {
      return _newTip;
    }
  }
};

BlockService.prototype._getBlockOperations = function(block) {

  var self = this;

  // block or [block]
  if (_.isArray(block)) {
    var ops = [];
    _.forEach(block, function(b) {
      ops.push(self._getBlockOperations(b));
    });
    return _.flatten(ops);
  }

  var operations = [];

  // block
  operations.push({
    type: 'put',
    key: self._encoding.encodeBlockKey(block.hash),
    value: self._encoding.encodeBlockValue(block)
  });

  return operations;

};

BlockService.prototype._getBlocksFromHashes = function(hashes) {

  var self = this;

  var blocks = hashes.map(function(hash) {

    var block = self._blockQueue.get(hash);

    if (!block) {
      log.error('block: '  + hash + ' was not found in our in-memory block cache.');
      this.node.stop();
      return;
    }

    return block;

  });

  return blocks;

};

BlockService.prototype._getChainwork = function(tipHash) {

  var block = this._blockQueue.get(tipHash);
  assert(block, 'expected to find a block in block queue for hash: ' + tipHash + ', but did not find it.');

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var prevChainwork;
  // if the previous block is the genesis block, then the chain work is the same for all know chains
  if (prevHash === this.GENESIS_HASH) {
    prevChainwork = new BN(new Buffer('0000000000000000000000000000000000000000000000000000000100010001', 'hex'));
  } else {
    var prevBlock = this._blockQueue.get(prevHash);

    assert(prevBlock, 'expected to find a previous block in block queue for hash: ' +
      prevHash + ', but did not find any.');

    // whatevs the latest chainwork in meta, this is the cumulative chainwork
    var lastChainwork = this._meta[this._meta.length - 1].chainwork;
    prevChainwork = new BN(new Buffer(lastChainwork, 'hex'));
  }

  return this._computeChainwork(block.header.bits, prevChainwork);
};

BlockService.prototype._getDelta = function(tip) {

  var blocks = [];
  var _tip = tip;

  while (_tip !== this._tip.hash) {
    var blk = this._blockQueue.get(_tip);
    _tip = utils.reverseBufferToString(blk.header.prevHash);
    blocks.push(blk);
  }

  return blocks;

};

BlockService.prototype._handleReorg = function(block) {

  this._reorging = true;
  log.warn('Chain reorganization detected! Our current block tip is: ' +
    this._tip.hash + ' the current block: ' + block.hash + '.');

  var commonAncestor = this._findCommonAncestor(block);

  if (!commonAncestor) {
    log.error('A common ancestor block between hash: ' + this._tip.hash + ' (our current tip) and: ' +
      block.hash + ' (the forked block) could not be found. Bitcore-node must exit.');
    this.node.stop();
    return;
  }

  log.warn('A common ancestor block was found to at hash: ' + commonAncestor + '.');
  this._setTip(block);
  this._broadcast(this.subscriptions.reorg, 'block/reorg', [block, commonAncestor]);
  this._reorging = false;

};

BlockService.prototype._isChainReorganizing = function(block) {

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  return prevHash !== this._tip.hash;

};

BlockService.prototype._isOrphanBlock = function(block) {

  // so this should fail - "is orphan"

  // we'll consult our metadata
  var i = this._meta.length - 1;
  for(; i >= 0; --i) {
    // if we find this block's prev hash in our meta collection, then we know all of its ancestors are there too
    if (block.hash === this._meta[i].hash) {
      return false;
    }
  }

  return true;
};

BlockService.prototype._loadMeta = function() {
  this._meta = this._db.loadBlockMetaData();
  if (!this._meta || this._meta.length < 1) {
    this._rebuildMetaData();
  }
};

BlockService.prototype._loadTip = function() {
  var self = this;
  self._db.getServiceTip('block');
};

BlockService.prototype._onBestHeight = function(height) {

  var self = this;
  self._bestHeight = height;

  // once we have best height, we know the p2p network is ready to go
  self._db.once('tip-block', self._onTipBlock.bind(self));

  self._loadTip();
};

BlockService.prototype._onBlock = function(block) {

  // 1. have we already seen this block?
  if (this._blockAlreadyProcessed(block)) {
    return;
  }

  // 2. log the reception
  log.debug('New block received: ' + block.hash);

  // 3. store the block for safe keeping
  this._cacheBlock(block);

  // 4. add block to meta
  this._updateMeta(block);

  // 5. determine block state, reorg, orphaned, normal
  var blockState = this._determineBlockState(block);

  // 6. add block to chainTips
  this._updateChainTips(block, blockState);

  // 7. react to state of block
  switch (blockState) {
    case 'orphaned':
      // nothing to do, but wait until ancestor blocks come in
      break;
    case 'reorg':
      this.emit('reorg', block);
      break;
    default:
      // send all unsent blocks now that we have a complete chain
      this._sendDelta();
      break;
  }
};

BlockService.prototype._onDbError = function(err) {

  log.error('Block Service: Error: ' + err + ' not recovering.');
  this.node.stop();

};

// --- mark 1
BlockService.prototype._onTipBlock = function(tip) {

  var self = this;
  if (tip) {

    self._tip = tip;

  } else {

    self._tip = {
      height: 0,
      hash: self.GENESIS_HASH
    };

  }

  self._chainTips.push(self._tip.hash);
  self._startSubscriptions();
  self._startSync();

};

BlockService.prototype._rebuildMetaData = function() {
  // we have to go through all the blocks in the database and calculate chainwork
  // TODO: implement this
  this._meta = [{
    hash: this.GENESIS_HASH,
    chainwork: '0000000000000000000000000000000000000000000000000000000100010001'
  }];
};

BlockService.prototype._reportBootStatus = function() {

  var blockInfoString = utils.getBlockInfoString(this._tip.height, this._bestHeight);

  log.info('Block Service tip is currently height: ' + this._tip.height + ' hash: ' +
    this._tip.hash + ' P2P network best height: ' + this._bestHeight + '. Block Service is: ' +
    blockInfoString);

};


BlockService.prototype._saveMetaData = function() {
  try {
    this._db.saveBlockMetaData(this._meta);
  } catch(e) {
    log.error('Block meta file failed to save, error: ' + e);
  }
};

/*
    Since blocks can arrive out of order from our trusted peer, we can't rely on the latest block
    being the tip of the main/active chain. We should, instead, take the chain with the most work completed.
    We need not concern ourselves whether or not the block is valid, we trust our peer to do this validation.
*/
BlockService.prototype._selectActiveChain = function() {

  var chainTip;
  var mostChainWork = new BN(0);

  var self = this;

  for(var i = 0; i < this._chainTips.length; i++) {

    var work = self._getChainwork(this._chainTips[i]);

    if (work.gt(mostChainWork)) {
      mostChainWork = work;
      chainTip = this._chainTips[i];
    }
  }

  return chainTip;

};


BlockService.prototype._sendDelta = function() {

  // when this function is called, we know, for sure, that we have a complete chain of unsent block(s).
  // our task is to send all blocks between active chain's tip and our tip.
  var activeChainTip = this._selectActiveChain();

  var blocks = this._getDelta(activeChainTip);

  for(var i = 0; i < blocks.length; i++) {
    this._broadcast(this._subscriptions.block, 'block/block', blocks[i]);
  }

  var len = this._meta.length - 1;
  this._setTip({ height: len, hash: this._meta[len].hash });

  if (++this._blockCount >= BlockService.MAX_BLOCKS) {
    this._latestBlockHash = this._tip.hash;
    this._numCompleted = this._tip.height;
    this._blockCount = 0;
    this._sync();
  }

};

BlockService.prototype._setListeners = function() {

  var self = this;

  self._p2p.once('bestHeight', self._onBestHeight.bind(self));
  self._db.on('error', self._onDbError.bind(self));
  self.on('reorg', self._handleReorg.bind(self));

};

BlockService.prototype._setMetaData = function(block) {
  this._meta.push({
    chainwork: this._getChainwork(block.hash).toString(16, 64),
    hash: block.hash
  });
};

BlockService.prototype._setTip = function(tip) {
  log.debug('Setting tip to height: ' + tip.height);
  this._tip = tip;
  this._db.setServiceTip('block', this._tip);
};

BlockService.prototype._startSync = function() {

  var currentHeight = this._tip.height;
  this._numNeeded = this._bestHeight - currentHeight;
  this._numCompleted = currentHeight;
  if (this._numNeeded <= 0) {
    return;
  }

  log.info('Gathering: ' + this._numNeeded + ' ' + 'block(s) from the peer-to-peer network.');

  this._p2pBlockCallsNeeded = Math.ceil(this._numNeeded / 500);
  this._latestBlockHash = this._tip.hash || this.GENESIS_HASH;
  this._sync();
};

BlockService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('p2p/block', this._onBlock.bind(this));
  this._bus.subscribe('p2p/block');
};

BlockService.prototype._sync = function() {

  if (--this._p2pBlockCallsNeeded > 0) {

    log.info('Blocks download progress: ' + this._numCompleted + '/' +
      this._numNeeded + '  (' + (this._numCompleted/this._numNeeded*100).toFixed(2) + '%)');
    this._p2p.getBlocks({ startHash: this._latestBlockHash });
    return;

  }

};

BlockService.prototype._updateChainTips = function(block, state) {

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  // otherwise we are not an orphan, so we could be a reorg or normal
  // if this is a normal state, then we are just adding ourselves as the tip on the main chain
  if (state === 'normal') {

    var index = this._chainTips.indexOf(prevHash);
    assert(index > -1, 'Block state is normal, ' +
      'yet the previous block hash is missing from the chain tips collection.');

    this._chainTips.push(block.hash);
    this._chainTips.splice(index, 1);
    return;

  }

  // if this is a reorg state, then a new chain tip will be added to the list
  if (state === 'reorg') {

    this._chainTips.push(block.hash);

  }

};

BlockService.prototype._updateMeta = function(block) {
  // should always have at least one item in here.
  var self = this;
  var latestMetaHash = self._meta[self._meta.length - 1].hash;
  var prevHash = utils.reverseBufferToString(block.header.prevHash);
  if (prevHash === latestMetaHash) {
    self._setMetaData(block);
    latestMetaHash = block.hash;
    // check for past orphans that we can now stack on top
    self._blockQueue.rforEach(function(v) {
      if (latestMetaHash === utils.reverseBufferToString(v.header.prevHash)) {
        self._setMetaData(v);
        latestMetaHash = v.hash;
      }
    });
  }
};

module.exports = BlockService;
