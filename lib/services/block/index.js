'use strict';

var async = require('async');
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

  //memory
  this._maxMem = options.maxMemory || 1500; // in MB
  this._deferTimeout = null;

  // meta is [{ chainwork: chainwork, hash: hash }]
  this._meta = [];

  // in-memory full/raw block cache
  this._blockQueue = LRU({
    max: 50 * (1 * 1024 * 1024), // 50 MB of blocks,
    length: function(n) {
      return n.toBuffer().length;
    }
  }); // hash -> block

  // keep track of out-of-order blocks, this is a list of chains (which are lists themselves)
  // e.g. [ [ block5, block4 ], [ block8, block7 ] ];
  this._incompleteChains = [];
  // list of all chain tips, including main chain and any chains that were orphaned after a reorg
  this._chainTips = [];
  this._blockCount = 0;
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];

};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'p2p', 'db' ];

BlockService.MAX_CHAINWORK = new BN(1).ushln(256);
BlockService.MAX_BLOCKS = 500;

// --- public prototype functions
BlockService.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getRawBlock', this, this.getRawBlock, 1],
    ['getBlockHeader', this, this.getBlockHeader, 1],
    ['getBlockOverview', this, this.getBlockOverview, 1],
    ['getBestBlockHash', this, this.getBestBlockHash, 0]
  ];
  return methods;
};

BlockService.prototype.getBestBlockHash = function(callback) {
  return callback(null, this._meta[this._meta.length - 1].hash);
};

BlockService.prototype.getBlock = function(arg, callback) {

  var hash = this._getHash(arg);

  if (!hash) {
    return callback();
  }

  this._getBlock(hash, callback);

};


BlockService.prototype.getBlockHeader = function(blockArg, callback) {

  blockArg = this._getHash(blockArg);

  if (!blockArg) {
    return callback();
  }

  this._getBlock(blockArg, function(err, block) {

    if(err) {
      return callback(err);
    }

    if (!block) {
      return callback();
    }

    callback(null, block.header.toJSON());

  });

};

BlockService.prototype.getBlockOverview = function(hash, callback) {

  this._getBlock(hash, function(err, block) {

    if (err) {
      return callback(err);
    }

    var blockOverview = {
      hash: block.hash,
      version: block.header.version,
      confirmations: null,
      height: null,
      chainWork: null,
      prevHash: utils.reverseBufferToString(block.header.prevHash),
      nextHash: null,
      merkleRoot: block.header.merkleroot,
      time: null,
      medianTime: null,
      nonce: block.header.nonce,
      bits: block.header.bits,
      difficulty: null,
      txids: null
    };
    callback(null, blockOverview);
  });

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

BlockService.prototype.getRawBlock = function(hash, callback) {
  this.getBlock(hash, function(err, block) {
    if(err) {
      return callback(err);
    }
    callback(null, block.toString());
  });
};

BlockService.prototype.isSynced = function(callback) {
  callback(null, this._p2p.getBestHeight <= this._tip.height);
};

BlockService.prototype.start = function(callback) {

  var self = this;

  async.waterfall([
    function(next) {
      self._db.getPrefix(self.name, next);
    },
    function(prefix, next) {
      self._prefix = prefix;
      self._encoding = new Encoding(self._prefix);
      self._db.getServiceTip('block', next);
    },
    function(tip, next) {
      self._tip = tip;
      self._chainTips.push(self._tip.hash);
      self._loadMeta(next);
    }
  ], function(err) {
    if(err) {
      return callback(err);
    }
    self._setListeners();
    self._startSubscriptions();
    callback();
  });

};

BlockService.prototype.stop = function(callback) {
  if (this._deferTimeout) {
    this._deferTimeout.unref();
  }
  callback();
};

BlockService.prototype.subscribe = function(name, emitter) {

  this._subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'block/' + name, 'total:', this._subscriptions[name].length);

};

BlockService.prototype.syncPercentage = function(callback) {
  var p2pHeight = this._p2p.getBestHeight();
  var percentage =  ((p2pHeight / (this._tip.height || p2pHeight)) * 100).toFixed(2);
  callback(null, percentage);
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

  if (this._isOutOfOrder(block)) {
    return 'outoforder';
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
      return this._blockQueue.get(_newTip);
    }
  }
};

BlockService.prototype._getBlock = function(hash, callback) {
  var block = this._blockQueue(hash);
  if (block) {
    return callback(null, block);
  }
  this._db.get(this._encoding.encodeBlockKey(hash), callback);
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

BlockService.prototype._getChainwork = function(tipHash) {

  var block = this._blockQueue.get(tipHash);

  var lastChainwork = this._meta[this._meta.length - 1].chainwork;
  var prevChainwork = new BN(new Buffer(lastChainwork, 'hex'));

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

  blocks.reverse();
  return blocks;

};

BlockService.prototype._getHash = function(blockArg) {

  return (_.isNumber(blockArg) || (blockArg.length < 40 && /^[0-9]+$/.test(blockArg))) &&
    this._meta[blockArg] ? this._meta[blockArg] : null;

};

BlockService.prototype._getIncompleteChainIndexes = function(block) {
  var ret = [];
  for(var i = 0; i < this._incompleteChains.length; i++) {
    var chain = this._incompleteChains[i];
    var lastEntry = chain[chain.length - 1];
    if (utils.reverseBufferToString(lastEntry.header.prevHash) === block.hash) {
      ret.push(i);
    }
  }
  return ret;
};

BlockService.prototype._getOldBlocks = function(currentHash, commonAncestorHash) {
  // the old blocks should be in the meta colection

  if (currentHash === commonAncestorHash || !commonAncestorHash || !currentHash) {
    return;
  }

  var oldBlocks;
  for(var i = this._meta.length - 1; i > 0; --i) {
    var item = this._meta[i];
    if (item.hash === currentHash) {
      oldBlocks = [this._blockQueue.get(currentHash)];
      continue;
    }
    if (item.hash === commonAncestorHash) {
      return oldBlocks;
    }
    oldBlocks.push(this._blockQueue.get(item.hash));
  }

};

BlockService.prototype._handleReorg = function(block) {

  this._reorging = true;

  log.warn('Chain reorganization detected! Our current block tip is: ' +
    this._tip.hash + ' the current block: ' + block.hash + '.');

  var commonAncestor = this._findCommonAncestor(block);
  var oldBlocks = this._getOldBlocks(this._tip.hash, block.hash, commonAncestor.hash);

  if (!commonAncestor || !oldBlocks || oldBlocks.length < 1) {
    log.error('A common ancestor block between hash: ' + this._tip.hash + ' (our current tip) and: ' +
      block.hash + ' (the forked block) could not be found. Bitcore-node must exit.');
    this.node.stop();
    return;
  }

  log.warn('A common ancestor block was found to at hash: ' + commonAncestor.hash + '.');

  this._broadcast(this.subscriptions.reorg, 'block/reorg', [oldBlocks, [block], commonAncestor]);

  this._onReorg(oldBlocks, [block], commonAncestor);

  this._reorging = false;
};

BlockService.prototype._onReorg = function(oldBlockList, newBlockList, commonAncestor) {

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ height: commonAncestor.header.height });

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];


  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.concat([
      {
        type: 'del',
        key: this.encoding.encodeBlockKey(block.header.timestamp),
      },
      {
        type: 'del',
        key: this.encoding.encodeMetaKey(block.header.height),
      }
    ]);
  });

  this._db.batch(removalOps);

  // remove the blocks from the in-memory meta list
  var newMetaHeight = commonAncestor.header.height;
  for(var i = this._meta.length - 1; i > 0; --i) {
     if (i > newMetaHeight) {
       this._meta.splice(i, 1);
     }
  }

  //call onBlock for each of the new blocks
  newBlockList.forEach(this._onBlock.bind(this));
  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (this._tip.height <= commonAncestor.header.height) {
    return;
  }

};

BlockService.prototype._isChainReorganizing = function(block) {

  // if we aren't an out of order block, then is this block's prev hash our tip?
  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  return prevHash !== this._tip.hash;

};

BlockService.prototype._isOutOfOrder = function(block) {

  // is this block the direct child of one of our chain tips? If so, not an out of order block
  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  for(var i = 0; i < this._chainTips.length; i++) {
    var chainTip = this._chainTips[i];
    if (chainTip === prevHash) {
      return false;
    }
  }

  return true;

};

BlockService.prototype._loadMeta = function(callback) {
  var self = this;
  var criteria = {
    gte: self._encoding.encodeMetaKey(0),
    lte: self._encoding.encodeMetaKey(0xffffffff)
  };

  var stream = this._db.createReadStream(criteria);

  stream.on('end', function() {
    if (self._meta.length < 1) {
      self._meta.push({
        chainwork: '0000000000000000000000000000000000000000000000000000000100010001',
        hash: self.GENESIS_HASH
      });
    }
    callback();
  });

  stream.on('data', function(data) {
    self._meta.push(self._encoding.decodeMetaValue(data.value));
  });
};

BlockService.prototype._onBestHeight = function(height) {
  this._bestHeight = height;
  this._startSync();
};

BlockService.prototype._onBlock = function(block) {

  // 1. have we already seen this block?
  if (this._blockAlreadyProcessed(block)) {
    return;
  }

  // 2. log the reception
  log.debug2('New block received: ' + block.hash);

  // 3. store the block for safe keeping
  this._cacheBlock(block);

  // 4. don't process any more blocks if we are currently in a reorg
  if (this._reorging) {
    return;
  }
  // 5. determine block state, reorg, outoforder, normal
  var blockState = this._determineBlockState(block);

  // 6. update internal data structures depending on blockstate
  this._updateChainInfo(block, blockState);

  // 7. react to state of block
  switch (blockState) {
    case 'outoforder':
      // nothing to do, but wait until ancestor blocks come in
      break;
    case 'reorg':
      this._handleReorg();
      this.emit('reorg', block);
      break;
    default:
      // send all unsent blocks now that we have a complete chain
      this._saveMetaData(block);
      this._sendDelta();
      break;
  }
};

BlockService.prototype._saveMetaData = function(block) {
  var item = {
    chainwork: this._getChainwork(block.hash).toString(16, 64),
    hash: block.hash
  };

  this._meta.push(item);

  var operations = [];

  // tip
  this._tip.hash = block.hash;
  this._tip.height = this._meta.length;

  var tipInfo = utils.encodeTip(this._tip, this.name);

  operations.push({
    type: 'put',
    key: tipInfo.key,
    value: tipInfo.value
  });

  //meta positions in db
  operations.push({
    type: 'put',
    key: this._encoding.encodeMetaKey(this._meta.length - 1),
    value: this._encoding.encodeMetaValue(item)
  });

  this._db.batch(operations);
};


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
    this._blockCount = 0;
    this._continueSync();
  }

};

BlockService.prototype._continueSync = function() {
  /*
     Essentially, we have three distinct tasks taking place during a sync operation

     1. receiving network data
     2. light processing of that data (data manipulation)
     3. writing that data to disk

     Our goal: Sync as quickly as our least performant task will allow using a modest amount of memory.
     If our network is very fast and our disk is very slow and we have very little memory to work with,
     this is the worst case scenario. We want to defer asking the p2p service for more blocks until the
     disk has time to process all the queued everts.

     Our way of dealing with this is to review the resident set size and defer the next call to sync if
     we are in danger of a 'JS Object Allocation Failed - Out of Memory' fault.

     You can use the "maxMemory" config setting for this service to limit the amount of memory considered.
     The default is 1.5GB of memory, max.

     If we are over 95% of max memory usage, we will defer the sync until we are 95% or less.
  */

  var self = this;
  var totalRss = process.memoryUsage().rss;
  if ((totalRss / 1E6) / self._maxMem > 0.95) {
    self._deferTimeout = setTimeout(function() {
      self._continueSync();
    }, 1000);
    return;
  }
  self._sync();
};

BlockService.prototype._setListeners = function() {

  this._p2p.once('bestHeight', this._onBestHeight.bind(this));

};

BlockService.prototype._setTip = function(tip) {
  log.debug('Setting tip to height: ' + tip.height);
  log.debug('Setting tip to hash: ' + tip.hash);
  this._tip = tip;
};

BlockService.prototype._startSync = function() {

  this._numNeeded = this._bestHeight - this._tip.height;
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

    log.info('Blocks download progress: ' + this._tip.height + '/' +
      this._numNeeded + '  (' + (this._tip.height / this._numNeeded*100).toFixed(2) + '%)');
    this._p2p.getBlocks({ startHash: this._latestBlockHash });
    return;

  }

};

BlockService.prototype._updateChainInfo = function(block, state) {

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  if (state === 'normal') {
    this._updateNormalStateChainInfo(block, prevHash);
    return;

  }

  if (state === 'reorg') {
    this._updateReorgStateChainInfo(block);
    return;
  }

  this._updateOutOfOrderStateChainInfo(block);

};


BlockService.prototype._updateNormalStateChainInfo = function(block, prevHash) {

  var index = this._chainTips.indexOf(prevHash);

  assert(index > -1, 'Block state is normal, ' +
    'yet the previous block hash is missing from the chain tips collection.');

  var incompleteChainIndexes = this._getIncompleteChainIndexes(block);
  //retrieving more than one incomplete chain for a given block means there is a future reorg in the incomplete chain
  if (incompleteChainIndexes.length < 1) {
    this._chainTips.push(block.hash);
  } else {

    incompleteChainIndexes.sort().reverse();
    for(var i = 0; i < incompleteChainIndexes.length; i++) {
      var incompleteIndex = incompleteChainIndexes[i];
      this._chainTips.push(this._incompleteChains[incompleteIndex][0].hash);
      this._incompleteChains.splice(incompleteIndex, 1);
    }

  }

  this._chainTips.splice(index, 1);

};

BlockService.prototype._updateOutOfOrderStateChainInfo = function(block) {

  /*
     At this point, we know we have a block that arrived out of order
     so we need to search through our existing incomplete chains to detect the following criteria:

   1. one of more of the chains has us as the last block in the chain
      (we are the parent to every other block in that chain)
   2. one of more of the chains has us as the first block in the chain
      (we are the youngest block in the chain)
   3. there are no chains that reference us as prev hash and our prev hash does not exist in any chain.
      (we create a new incomplete chain with us as the only enrtry)

  */

  var prevHash = utils.reverseBufferToString(block.header.prevHash);
  var possibleJoins = { tip: [], genesis: [] };
  var newChains = [];
  var joinedChains = false;

  for(var i = 0; i < this._incompleteChains.length; i++) {


    // if we see that a block is the tip of one chain and the genesis of another,
    // then we can join those chains together.

    var chain = this._incompleteChains[i];
    var firstEntry = chain[0];
    var lastEntry = chain[chain.length - 1];
    var chains;

    // criteria 1
    var lastEntryPrevHash = utils.reverseBufferToString(lastEntry.header.prevHash);
    if (lastEntryPrevHash === block.hash) {

      joinedChains = true;
      if (possibleJoins.tip.length > 0) {

        chains = utils.joinListsOnIndex(possibleJoins.tip, chain, this._incompleteChains);
        newChains = utils.removeItemsByIndexList(possibleJoins.tip, newChains);
        newChains = newChains.concat(chains);

      } else {

        // push the block on the end of chain
        chain.push(block);
        newChains.push(chain);
        possibleJoins.genesis.push(i);
      }
      continue;

    }

    // criteria 2
    if (firstEntry.hash === prevHash) {

      joinedChains = true;
      if (possibleJoins.genesis.length > 0) {

        chains = utils.joinListsOnIndex(possibleJoins.genesis, chain, this._incompleteChains, 'reverse');
        newChains = utils.removeItemsByIndexList(possibleJoins.genesis, newChains);
        newChains = newChains.concat(chains);

      } else {

        // have we already put our block as the genesis of some other chain, if so, join the chains
        // add the block as the first element on the chainf
        chain.unshift(block);
        newChains.push(chain);
        possibleJoins.tip.push(i);
      }
      continue;
    }

    newChains.push(chain);

  }


  if (joinedChains) {

    this._incompleteChains = newChains;
    return;
  }

  // criteria 3
  this._incompleteChains.push([block]);

};

BlockService.prototype._updateReorgStateChainInfo = function(block) {
  this._chainTips.push(block.hash);
};

module.exports = BlockService;
