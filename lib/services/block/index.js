'use strict';

var BaseService = require('../../service');
var bitcore = require('bitcore-lib');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var BufferUtil = bitcore.util.buffer;
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
  this._chainTips = LRU(50); // chain tip -> [ tip-1 hash, tip-2 hash, tip-N hash]
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
  var methods = [
    ['processBlockOperations', this, this.processBlockOperations, 1]
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

BlockService.prototype._printTipInfo = function(prependedMessage) {

  log.info(
    prependedMessage + ' Serial Tip: ' + this.tip.hash +
    ' Concurrent tip: ' + this.concurrentTip.hash
  );

};

BlockService.prototype._reportBootStatus = function() {
  var blockInfoString = utils.getBlockInfoString(this.tip.height, this.bestHeight);
  log.info('Block Service tip is currently height: ' + this.tip.height + ' hash: ' +
    this.tip.hash + ' P2P network best height: ' + this.bestHeight + '. Block Service is: ' +
    blockInfoString);
};

BlockService.prototype._setTip = function(block) {
  this.tip.height = block.height;
  this.tip.hash = block.hash;
  this._db.setServiceTip('block', this.tip);
};

BlockService.prototype.processBlockOperations = function(opts, callback) {

  if (!_.isArray(opts.operations)) {
    return;
  }

  var self = this;

  self._db.batch(opts.operations, function(err) {

    if(err) {
      return callback(err);
    }

    if (!opts.serviceName) {
      opts.serviceName = 'unknown';
    }

    self.setTip(opts);
    self._reportStatus(opts.serviceName);

    callback();
  });

};

BlockService.prototype.getTipOperation = function(block, add, tipType) {

  var heightBuffer = new Buffer(4);
  var tipData;

  if (add) {
    heightBuffer.writeUInt32BE(block.__height);
    tipData = Buffer.concat([new Buffer(block.hash, 'hex'), heightBuffer]);
  } else {
    heightBuffer.writeUInt32BE(block.__height - 1);
    tipData = Buffer.concat([BufferUtil.reverse(block.header.prevHash), heightBuffer]);
  }

  var type = tipType || 'tip';

  return {
    type: 'put',
    key: this.dbPrefix + type,
    value: tipData
  };
};



BlockService.prototype.getBlocks = function(startHash, endHash) {

  var self = this;
  assert(startHash && startHash.length === 64, 'startHash is required to getBlocks');

  // if start and end hash are the same, the caller is getting, at most, one block
  // otherwise, the caller gets all blocks from startHash to endHash, inclusive.

  // check our memory cache first, then db, then go out to p2p network

  // LRU in-memory
  var results = self._getCachedBlocks(startHash, endHash);

  // in db
  if (!results) {
    results = self._getBlocksInDb(startHash, endHash);
  }

  var lockedOut = self._getBlocksLockedOut();
  if (!results && !lockedOut) {
    self._p2p.getBlocks({ startHash: startHash });
    return true;
  }

  if (lockedOut) {
    log.debug('Block Service: getBlocks called, but service is still in a lock out period.');
    return false;
  }
};

BlockService.prototype._checkCache = function(key, cache) {
  return cache.get(key);
};

BlockService.prototype.getBlockHeader = function(hash, callback) {

  var self = this;
  var header = self._checkCache(hash, self._blockHeaderQueue);

  if (header) {
    return callback(null, header);
  }

  self._p2p.getBlockHeaders(hash);
  var timer = setInterval(function() {
    var header = self._checkCache(hash, self._blockHeaderQueue);
    if (header) {
      clearInterval(timer);
      callback(null, header);
    }
  }, 250);
  timer.unref();
};

BlockService.prototype.getBlockHash = function(height, callback) {

  this._getBlockValue(height, callback);

};

BlockService.prototype.getBlockHeight = function(hash, callback) {

  this._getBlockValue(hash, callback);

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
  // if the block is not in our block header queue, we probably have not seen it, or
  // it is older than about 1000 blocks
  return this._blockHeaderQueue.get(block.hash);
};

BlockService.prototype._mergeBlockIntoChainTips = function(block) {

  function getPrevHashChain(keys, hash) {

    for(var i = 0; i <  keys.length; i++) {
console.log('here');

      var key = keys[i];

      var searchChain = this._chainTips.get(key);
      console.log(searchChain);

      var chainIndex = searchChain.indexOf(hash);

      if (chainIndex > -1) {
        return searchChain.slice(chainIndex);
      }
    }

  }


  var prevHash = utils.reverseBufferToString(block.header.prevHash);
  var hasChildren = false;

  var chain = this._chainTips.get(prevHash);
  if (chain) {
    chain.unshift(prevHash);
  }

  var keys = this._chainTips.keys();

  // looking for chains where this block is an ancestor of the tip of the chain
  for(var i = 0; i < keys.length; i++) {

    var key = keys[i];
    var searchChain = this._chainTips.get(key);

    var chainIndex = searchChain.indexOf(block.hash);

    if (chainIndex > -1) {
      hasChildren = true;
      var newChain = searchChain.concat(chain || getPrevHashChain(keys, prevHash));
      this._chainTips.set(key, newChain);
    }

  }

  if (chain && !hasChildren) {

    this._chainTips.set(block.hash, chain);

  }

  this._chainTips.del(prevHash);

  // if we have don't have any parents or children in chainTips, then create a new chain with this block
  if (!hasChildren && !chain) {
    this._chainTips.set(block.hash, getPrevHashChain(keys, prevHash));
  }

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
      this._queueOrphanedBlock(block);
      break;
    case 'reorg':
      this.emit('reorg', block);
      break;
    default:
      this.setTip(block);
      this._broadcast(this.subscriptions.blocks, 'block/block', block);
      // check to see if we can broadcast, previously orphaned blocks on the main chain.
      break;
  }

};

BlockService.prototype._setTip = function() {
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
      never become the main chain. Also, your peers may nor may not give you all the parent blocks for this orphan chain.
      It is best to not assign this block a height until all of its parents are linked. We should, however, call getBlocks with
      startHash of our tip and end hash of the list of orphaned blocks periodically.

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


BlockService.prototype._isGetP2PBlocksLockedOut = function() {
  return Date.now() < (this._getP2PBlocksLockoutPeriod + (this._previousdGetP2PBlocksLockTime || 0));
};

BlockService.prototype._getP2PBlocks = function() {
  if (!!this._isGetP2PBlocksLockedOut()) {
    this._previousdGetP2PBlocksLockTime = Date.now();
    this._p2p.getBlocks({ startHash: startHash });
  }
};

BlockService.prototype._getBlockValue = function(hashOrHeight, callback) {

  var self = this;

  var key, valueFn;

  if (hashOrHeight.length < 64) {
    key = self.encoding.encodeBlockHeightKey(parseInt(hashOrHeight));
    valueFn = self.encoding.decodeBlockHashValue.bind(self.encoding);
  } else {
    key = self.encoding.encodeBlockHashKey(hashOrHeight);
    valueFn = self.encoding.decodeBlockHeightValue.bind(self.encoding);
  }

  self._db.get(key, function(err, buf) {

    if (err) {
      return callback(err);
    }
    callback(null, valueFn(buf));

  });

};

BlockService.prototype._isGenesisBlock = function(blockArg, callback) {

  if (blockArg.length === 64) {

    return this._getBlockValue(blockArg, function(err, value) {

      if (err) {
        return callback(null, false);
      }

      if (value === 0) {
        return callback(null, true);
      }

      callback(null, false);

    });

  }

  setImmediate(function() {

    if (blockArg === 0) {
      return callback(null, true);
    }
    callback(null, false);
  });

};

BlockService.prototype._getReorgOperations = function(hash, height) {

  if (!hash || !height) {
    return;
  }

  var self = this;

  var heightKey = self.encoding.encodeBlockHeightKey(height);
  var hashKey = self.encoding.encodeBlockHashKey(hash);
  var heightValue = self.encoding.encodeBlockHeightValue(height);
  var newHashKey = self.encoding.encodeBlockHashKey(hash + '-REORG');
  var newHashValue = self.encoding.encodeBlockHashValue(hash + '-REORG');

  return [
    { action: 'del', key: heightKey },
    { action: 'del', key: hashKey },
    { action: 'put', key: newHashKey, value: heightValue },
    { action: 'put', key: heightKey, value: newHashValue }
  ];

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
BlockService.prototype._handleReorg = function(hash, callback) {

  // 1. log out that we are in a reorg state.
  //log.warn('Chain reorganization detected! Our current block tip is: this._tip.hash ' +

  //log.error('A common ancestor block between hash: ' + this.tip.hash + ' (our current tip) and: ' +
  //  block.hash + ' (the forked block) could not be found.');

  //this.node.stop();

  //var self = this;
  //self._printTipInfo('Reorg detected!');

  //self.reorg = true;
  //self.emit('reorg');

  //var reorg = new Reorg(self.node, self);

  //reorg.handleReorg(hash, function(err) {

  //  if(err) {
  //    log.error('Reorg failed! ' + err);
  //    self.node.stop();
  //  }

  //  self._printTipInfo('Reorg successful!');
  //  self.reorg = false;
  //  self.cleanupAfterReorg(callback);

  //});

};


module.exports = BlockService;
