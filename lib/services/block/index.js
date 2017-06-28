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

var BlockService = function(options) {
  BaseService.call(this, options);
  this.tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._subscriptions = {};
  this._subscriptions.block = [];
  this._subscriptions.reorg = [];
  this._blockHeaderQueue = LRU(20000); // hash -> header, height -> header
  this._blockQueue = LRU({
    max: 50,
    length: function(n) {
      return n.length * (1 * 1024 * 1024); // 50 MB of blocks
    }
  }); // header -> block
  this._chainTips = LRU(50); // chain tip hash -> [ tip-prev hash, tip-prevprev hash, tip-prevprevprev hash, ... ]
};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'p2p', 'db' ];

BlockService.prototype.start = function(callback) {

  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    self._setListeners();
    callback();
  });

};

BlockService.prototype.stop = function(callback) {

  if (callback) {
    setImmediate(callback);
  }
};

BlockService.prototype.getAPIMethods = function() {
  var methods = [];
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

BlockService.prototype._reportBootStatus = function() {

  var blockInfoString = utils.getBlockInfoString(this.tip.height, this.bestHeight);

  log.info('Block Service tip is currently height: ' + this.tip.height + ' hash: ' +
    this.tip.hash + ' P2P network best height: ' + this._bestHeight + '. Block Service is: ' +
    blockInfoString);

};

BlockService.prototype._startSubscriptions = function() {

  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self.bus = self.node.openBus({remoteAddress: 'localhost'});

  self.bus.on('p2p/block', self._onBlock.bind(self));
  self.bus.on('p2p/headers', self._onHeaders.bind(self));

  self.bus.subscribe('p2p/block');
  self.bus.subscribe('p2p/headers');

};

BlockService.prototype._onHeaders = function(headers) {

  log.info('New headers received.');
  this._cacheHeaders(headers);

};

BlockService.prototype._blockAlreadyProcessed = function(block) {

  return this._blockHeaderQueue.get(block.hash);

};

BlockService.prototype._mergeBlockIntoChainTips = function(block) {

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var chain = this._chainTips.get(prevHash);

  this._chainTips.del(prevHash);

  if (chain) {
    chain.unshift(prevHash);
  }

  var longestChain = this._findLongestChainForHash(prevHash);
  var hasChildren = this._setChainOnTip(block.hash, chain, longestChain);

  if (!hasChildren) {
    this._chainTips.set(block.hash, chain || longestChain);
  }

};

BlockService.prototype._setChainOnTip = function(hash, chain, longestPrevChain) {

  var keys = this._chainTips.keys();
  var hasChildren = false;

  for(var i = 0; i < keys.length; i++) {

    var key = keys[i];
    var searchChain = this._chainTips.get(key);


    var chainIndex = searchChain.indexOf(hash);

    if (chainIndex > -1) {
      hasChildren = true;
      this._chainTips.set(key, searchChain.concat(chain || longestPrevChain));
    }
  }

  return hasChildren;
};

BlockService.prototype._findLongestChainForHash = function(hash) {

  var longestChain = [];
  var keys = this._chainTips.keys();

  for(var i = 0; i < keys.length; i++) {

    var key = keys[i];
    var searchChain = this._chainTips.get(key);

    assert(searchChain.length > 0, 'chain tips collection appears to be invalid');

    var chainIndex = searchChain.indexOf(hash);

    if (chainIndex > -1) {

      var chain = searchChain.slice(chainIndex);
      if (chain.length > longestChain.length) {
        longestChain = chain;
      }
    }
  }

  longestChain = longestChain.length <= 1 ? [hash] : longestChain;
  return longestChain;
};

BlockService.prototype._onBlock = function(block) {

  // 1. have we already seen this block?
  if (this._blockAlreadyProcessed(block)) {
    return;
  }

  // 2. log the reception
  log.info('New block received: ' + block.hash);

  // 3. store the block for safe keeping
  this._cacheBlock(block);

  // 4. merge this block into the set of chain tips
  this._mergeBlockIntoChainTips(block);

  // 5. determine block state, reorg, orphaned, normal
  var blockState = this._determineBlockState(block);

  // 6. react to state of block
  switch (blockState) {
    case 'orphaned':
      break;
    case 'reorg':
      this.emit('reorg', block);
      break;
    default:
      var activeChainTip = this._selectActiveChain(block);
      this._sendAllUnsentBlocksFromAcitveChain(activeChainTip);
      break;
  }

};

BlockService.prototype._selectActiveChain = function(hash) {
  // the active chain is the one that the passed in block hash has as its tip.
  // there can only be one without there being a ambiguous situation.
  // If more than one chain does have the latest incoming block, then we have a reorg
  // situation on our hands and the active chain will be decided elsewhere

};

BlockService.prototype._getAllUnsentBlocksFromActiveChain = function(block) {

  var blocksToSend = [block];

  if (!this._chainTips.get(block.hash)) {

    var keys = this._chainTips.keys();

    for(var i = 0; i < keys.length; i++) {

      var key = keys[i];
      var searchChain = this._chainTips.get(key);
      var index = searchChain.indexOf(block.hash);

      if (index > -1) {
        var additionalBlockHashes = [key].concat(searchChain.slice(0, index));
        var additionalBlocks = this._getBlocksFromHashes(additionalBlockHashes);
        blocksToSend.concat(additionalBlocks);
        blocksToSend.reverse();
        break;
      }
    }
  }
};

BlockService.prototype._sendAllUnsentBlocksFromActiveChain = function(tip) {

  var blocks = this._getAllUnsentBlocksFromActiveChain(tip);

  for(var j = 0; j < blocks.length; j++) {
    this._broadcast(this._subscriptions.block, 'block/block', blocks[j]);
  }

  this._setTip(blocks[j-1]);

};

BlockService.prototype._getBlocksFromHashes = function(hashes) {

  var self = this;

  var blocks = hashes.map(function(hash) {

    var hdr = self._blockHeaderQueue.get(hash);

    if (!hdr) {
      log.error('header for hash: ' + hash + ' could not found in our in-memory block header cache.');
      this.node.stop();
      return;
    }

    var block = self._blockQueue.get(hdr);
    if (!block) {
      log.error('block: '  + hash + ' was not found in our in-memory block cache.');
      this.node.stop();
      return;
    }

    return block;

  });

  return blocks;

};

BlockService.prototype._handleReorg = function(block) {

  this._reorging = true;
  log.warn('Chain reorganization detected! Our current block tip is: ' +
    this.tip.hash + ' the current block: ' + block.hash + '.');

  var commonAncestor = this._findCommonAncestor(block);

  if (!commonAncestor) {
    log.error('A common ancestor block between hash: ' + this.tip.hash + ' (our current tip) and: ' +
      block.hash + ' (the forked block) could not be found. Bitcore-node must exit.');
    this.node.stop();
    return;
  }

  log.info('A common ancestor block was found to at hash: ' + commonAncestor + '.');
  this._setTip(block);
  this._broadcast(this.subscriptions.reorg, 'block/reorg', [block, commonAncestor]);
  this._reorging = false;

};

BlockService.prototype._findCommonAncestor = function(block) {

  assert(this._chainTips.length > 1,
    'chain tips collection should have at least 2 chains in order to find a common ancestor.');

  var oldChain = this._chainTips.get(this.tip.hash);
  var newChain = this._chainTips.get(block.hash);

  if (!newChain) {
    newChain = this._findLongestChainForHash(block.hash);
  }

  for(var i = 0; i < oldChain.length; i++) {
    var commonIndex = newChain.indexOf(oldChain[i]);
    if (commonIndex > -1) {
      return oldChain[i];
    }
  }

};

BlockService.prototype._setTip = function(block) {
  this.tip.height = block.height;
  this.tip.hash = block.hash;
  this._db.setServiceTip('block', this.tip);
};

BlockService.prototype._determineBlockState = function(block) {

  /*

    block could be in 1 of 3 possible states.

    1. normal state: block's prev hssh points to our current tip

    2. reorg state: block's prev hash points to block in our chain that is not the tip.

      Another way to express this is: New block's prev block ALREADY has another block pointing to it.

      This leads to 2 children, for 1 parent block, which is a fork and not a chain. This is a blockchain
      and not a blockfork ;) Thus, this new block should be considered the rightful child of its parent.
      Remember, this isn't a validating node. Blocks that are relayed to us are considered to be the authoritative.
      New blocks always trump what came before.

    3. orphaned state: block's prev hash is not in our chain at all. Possible reasons are:

      * blocks were delivered out of order, parent of this block is yet to come
      * blocks were, again, delivered out order, but the parent will never come

      In point 1, waiting longer for blocks to arrive is the best action.

      In point 2, waiting won't help. The block's parent block may be in an orphaned chain and this chain may
      never become the main chain. Also, your peers may nor may not give you all the parent blocks for this orphan
      chain. It is best to not assign this block a height until all of its parents are linked. We should, however,
      call getBlocks with startHash of our tip and end hash of the list of orphaned blocks periodically.

  */

  if (this._isOrphanBlock(block)) {
    return 'orphaned';
  }

  if (this._isChainReorganizing(block)) {
    return 'reorg';
  }

  return 'normal';

};

BlockService.prototype._isOrphanBlock = function(block) {

  // all blocks that we've seen before should be in the blockHeaderQueue, if this block's prev
  // hash isn't, then we definitely have an orphan block.
  var prevHash = utils.reverseBufferToString(block.header.prevHash);
  return !this._blockHeaderQueue.get(prevHash);

};

BlockService.prototype._isChainReorganizing = function(block) {

  if (!this._isOrphanBlock()) {
    var prevHash = utils.reverseBufferToString(block.header.prevHash);
    return prevHash !== this.tip.hash;
  }

  return false;

};

BlockService.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

BlockService.prototype._cacheBlock = function(block) {

  log.debug('Setting block: ' + block.hash + ' in the block cache.');

  // 1. set the block queue, which holds full blocks in memory
  this._blockQueue.set(block.hash, block);

  // 2. set the block header queue, which holds hash -> header -and- height -> headeer in memory
  this._blockHeader.set(block.hash, block.header.toObject()); // we don't know about the height yet

  // 3. store the block in the database
  var operations = this._getBlockOperations(block);

  this._db.batch(operations, function(err) {

    if(err) {
      log.error('There was an error attempting to save block hash: ' + block.hash);
      this._db.emit('error', err);
      return;
    }

    log.debug('Success saving block hash ' + block.hash);
  });

};

BlockService.prototype._getHeader = function(block) {

  return {
    hash: block.hash,
    version: 1,
    prevHash: utils.reverseBufferToString(block.header.prevHash),
    merkleRoot: utils.reverseBufferToString(block.header.merkleRoot),
    time: block.header.time,
    height: block.__height
  };
};

BlockService.prototype._setBlockHeaderQueue = function(header) {

  this._blockHeaderQueue.set(header.height, header);
  this._blockHeaderQueue.set(header.hash, header);

};

BlockService.prototype._setListeners = function() {
  var self = this;

  self._p2p.once('bestHeight', function(height) {

    self._bestHeight = height;

    // once we have best height, we know the p2p network is ready to go
    self.once('tip-block', function(tip) {
      self._tip = tip;

      self._startSubscriptions();
    });
    self._loadTip();

  });

  self._db.on('error', self._onDbError.bind(self));
  self.on('reorg', self._handleReorg.bind(self));

};


BlockService.prototype._loadTip = function() {
  this._db.getServiceTip('block');
};

BlockService.prototype._onDbError = function(err) {
  log.error('Block Service: Error: ' + err.message + ' not recovering.');
  this.node.stop();
};

BlockService.prototype._getBlockOperations = function(obj) {

  var self = this;

  if (_.isArray(obj)) {
    var ops = [];
    _.forEach(obj, function(block) {
      ops.push(self._getBlockOperations(block));
    });
    return _.flatten(ops);
  }

  var operations = [];

  operations.push({
    type: 'put',
    key: self.encoding.encodeBlockHashKey(obj.hash),
    value: self.encoding.encodeBlockHeightValue(obj.height)
  });

  operations.push({
    type: 'put',
    key: self.encoding.encodeBlockHeightKey(obj.height),
    value: self.encoding.encodeBlockHashValue(obj.hash)
  });

  return operations;

};


module.exports = BlockService;
