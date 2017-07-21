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
var constants = require('../../constants');

var BlockService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._header = this.node.services.header;

  this._subscriptions = {};
  this._subscriptions.block = [];
  this._subscriptions.reorg = [];

  // in-memory full/raw block cache
  this._blockQueue = LRU({
    max: 50 * (1 * 1024 * 1024), // 50 MB of blocks,
    length: function(n) {
      return n.size;
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

BlockService.dependencies = [ 'p2p', 'db', 'header' ];

BlockService.MAX_BLOCKS = 250;

// --- public prototype functions
BlockService.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getRawBlock', this, this.getRawBlock, 1],
    ['getBlockOverview', this, this.getBlockOverview, 1],
    ['getBestBlockHash', this, this.getBestBlockHash, 0]
  ];
  return methods;
};

BlockService.prototype.getBestBlockHash = function() {
  var headers = this._header.getAllHeaders();
  return headers[headers.length - 1].hash;
};

BlockService.prototype.getBlock = function(arg, callback) {

  var hash = this._getHash(arg);

  if (!hash) {
    return callback();
  }

  this._getBlock(hash, callback);

};

BlockService.prototype.getBlockOverview = function(hash, callback) {

  this._getBlock(hash, function(err, block) {

    if (err) {
      return callback(err);
    }

    var header = block.toHeaders().toJSON();

    var blockOverview = {
      hash: block.hash,
      version: header.version,
      confirmations: null,
      height: header.height,
      chainWork: header.chainwork,
      prevHash: header.prevBlock,
      nextHash: null,
      merkleRoot: block.merkleroot,
      time: header.timestamp,
      medianTime: null,
      nonce: block.nonce,
      bits: block.bits,
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
    callback(null, block.toRaw().toString('hex'));
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
      self._setTip(tip);
      self._chainTips.push(self._tip.hash);
      self._primeBlockQueue(next);
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

BlockService.prototype._primeBlockQueue = function(callback) {
  // this will load the last 50 blocks into the block queue to prime the cache
  var self = this;
  var hash = this._tip.hash;

  async.timesSeries(50, function(index, next) {

    self._db.get(self._encoding.encodeBlockKey(hash), function(err, data) {

      if(err) {
        return next(err);
      }

      if (!data) {
        return next();
      }

      var block = self._encoding.decodeBlockValue(data);
      hash = block.toHeaders().toJSON().prevBlock;
      self._blockQueue.set(block.rhash(), block);
      next();

    });

  }, callback);
};

// upon startup, has the chain reorg'ed from where we were when we shutdown?
BlockService.prototype._detectInitialChainState = function(headers) {

  if (this._tip.height === 0) {
    return;
  }

  var index = this._tip.height - 1;
  var record = Array.from(headers)[index];

  if (record[0] !== this._tip.hash) {
    // reorg! we don't yet have the blocks to reorg to, so we'll rewind the chain back to
    // to common ancestor, set the tip to the common ancestor and start the sync
    this._chainTips.push(record[0]);
    this._handleReorg(record[0]);
  }
};

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
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

  return this._blockQueue.get(block.rhash()) ? true : false;

};

BlockService.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

BlockService.prototype._cacheBlock = function(block) {

  log.debug('Setting block: ' + block.rhash() + ' in the block cache.');

  // 1. set the block queue, which holds full blocks in memory
  this._blockQueue.set(block.rhash(), block);

  // 2. store the block in the database
  var operations = this._getBlockOperations(block);

  this._db.batch(operations);
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

BlockService.prototype._findCommonAncestor = function(hash) {

  assert(this._chainTips.length > 1,
    'chain tips collection should have at least 2 chains in order to find a common ancestor.');

  var self = this;
  var headers = this._header.getAllHeaders();
  var count = 0;
  var _oldTip = this._tip.hash;
  var _newTip = hash;

  assert(_newTip && _oldTip, 'current chain and/or new chain do not exist in our list of chain tips.');

  async.whilst(
    // test case
    function() {

      return _oldTip !== _newTip || ++count <= headers.size;

    },
    // get block
    function(next) {

      // old tip has to be in database
      self._db.get(self._encoding.encodeBlockKey(_oldTip), function(err, data) {

        if (err || !data) {
          return next(err || new Error('missing block'));
        }

        var block = self._encoding.decodeBlockValue(data);
        _oldTip = block.toHeaders().toJSON().prevBlock;
        var header = headers.get(_newTip);

        if (!header) {
          return next(new Error('Header missing from list of headers'));
        }

        _newTip = header.prevHash;
        next();

      });

    },
    function() {

      this.emit('common ancestor', hash, _newTip === _oldTip ? _newTip : null);

    });
};

BlockService.prototype._getBlock = function(hash, callback) {

  var self = this;

  var block = this._blockQueue(hash);

  if (block) {
    return callback(null, block);
  }

  this._db.get(this._encoding.encodeBlockKey(hash), function(err, data) {

    if(err) {
      return callback(err);
    }

    if (!data) {
      return callback();
    }

    var block = self._encoding.decodeBlockValue(data);
    callback(null, block);

  });
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
    key: self._encoding.encodeBlockKey(block.rhash()),
    value: self._encoding.encodeBlockValue(block)
  });

  return operations;

};

BlockService.prototype._getDelta = function(tip) {

  var blocks = [];
  var _tip = tip;

  while (_tip !== this._tip.hash) {
    var blk = this._blockQueue.get(_tip);
    _tip = blk.toHeaders().toJSON().prevBlock;
    blocks.push(blk);
  }

  blocks.reverse();
  return blocks;

};

BlockService.prototype._getHash = function(blockArg) {

  var headers = this._header.getAllHeaders();

  if (utils.isHeight(blockArg)) {
    return Array.from(headers)[blockArg];
  }

};

BlockService.prototype._getIncompleteChainIndexes = function(block) {
  var ret = [];
  for(var i = 0; i < this._incompleteChains.length; i++) {
    var chain = this._incompleteChains[i];
    var lastEntry = chain[chain.length - 1].toHeaders().toJSON();
    if (lastEntry.prevHash === block.rhash()) {
      ret.push(i);
    }
  }
  return ret;
};

BlockService.prototype._getOldBlocks = function(currentHash, commonAncestorHash) {

  if (currentHash === commonAncestorHash || !commonAncestorHash || !currentHash) {
    return;
  }

  var oldBlocks;
  var headers = this._header.getAllHeaders();
  for(var i = headers.length - 1; i > 0; --i) {
    var item = headers[i];
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

BlockService.prototype._handleReorg = function(hash) {

  this._reorging = true; // while this is set, we won't be sending blocks

  log.warn('Chain reorganization detected! Our current block tip is: ' +
    this._tip.hash + ' the current block: ' + hash + '.');

  this._once('common ancestor', this._onCommonAncestor.bind(this));

  this._findCommonAncestor(hash);
};

// once we know what hash the commonAncestor is, we cna set the set the tip to it
// and gather blocks to remove
BlockService.prototype._onCommonAncestor = function(newHash, commonAncestorHeader) {

  var oldBlocks = this._getOldBlocks(this._tip.hash, newHash, commonAncestorHeader);

  if (!commonAncestorHeader || !oldBlocks || oldBlocks.length < 1) {

    log.error('A common ancestor block between hash: ' + this._tip.hash + ' (our current tip) and: ' +
      newHash + ' (the forked block) could not be found. Bitcore-node must exit.');

    this.node.stop();

    return;
  }

  // set tip to this common ancesttor
  log.warn('A common ancestor block was found to at hash: ' + commonAncestorHeader.hash + '.');

  this._broadcast(this.subscriptions.reorg, 'block/reorg', [oldBlocks, commonAncestorHeader]);

  this._onReorg(oldBlocks, commonAncestorHeader);

  this._reorging = false;
};

// this JUST rewinds the chain back to the common ancestor block, nothing more
BlockService.prototype._onReorg = function(oldBlockList, commonAncestorHeader) {

  // set the tip to the common ancestor in case something goes wrong with the reorg
  this._setTip({ hash: commonAncestorHeader.hash, height: commonAncestorHeader.height });
  var tipOps = utils.encodeTip(this._tip, this.name);

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.push({
      type: 'del',
      key: this.encoding.encodeBlockKey(block.rhash()),
    });
  });

  this._db.batch(removalOps);

};

BlockService.prototype._isChainReorganizing = function(block) {

  // if we aren't an out of order block, then is this block's prev hash our tip?
  var prevHash = block.toHeaders().toJSON().prevBlock;

  return prevHash !== this._tip.hash;

};

BlockService.prototype._isOutOfOrder = function(block) {

  // is this block the direct child of one of our chain tips? If so, not an out of order block
  var prevHash = block.toHeaders().toJSON().prevBlock;

  for(var i = 0; i < this._chainTips.length; i++) {
    var chainTip = this._chainTips[i];
    if (chainTip === prevHash) {
      return false;
    }
  }

  return true;

};

BlockService.prototype._onAllHeaders = function(headers) {
  this._bestHeight = headers.size;
  this._detectInitialChainState(headers);
  this._startSync();
};

BlockService.prototype._onBlock = function(block) {

  // 1. have we already seen this block?
  if (this._blockAlreadyProcessed(block)) {
    return;
  }

  // 2. log the reception
  log.debug('New block received: ' + block.rhash());

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
      this._handleReorg(block.hash);
      break;
    default:
      // send all unsent blocks now that we have a complete chain

      this._sendDelta();
      break;
  }
};

BlockService.prototype._selectActiveChain = function() {

  var chainTip;
  var mostChainWork = new BN(0);
  var headers = this._header.getAllHeaders();

  if (this._chainTips.length === 1) {
    return this._chainTips[0];
  }

  for(var i = 0; i < this._chainTips.length; i++) {

    var header = headers.get(this._chainTips[i]);
    assert(header, 'we must have a header for chain tip.');
    var work = new BN(new Buffer(header.chainwork, 'hex'));

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

  var newTipHeight = this._tip.height + i;
  var newTipHash = blocks[i - 1].rhash();

  this._setTip({ height: newTipHeight, hash: newTipHash });
  var tipOps = utils.encodeTip(this._tip, this.name);

  var ops = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  this._db.batch(ops);

  if (++this._blockCount >= BlockService.MAX_BLOCKS) {
    this._blockCount = 0;
    log.debug('Block Service: calling sync again for more blocks.');
    this._sync();
  }

};

BlockService.prototype._setListeners = function() {

  this._header.once('headers', this._onAllHeaders.bind(this));

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

  this._sync();
};

BlockService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost-block'});
  }

  this._bus.on('p2p/block', this._onBlock.bind(this));
  this._bus.subscribe('p2p/block');
};

BlockService.prototype._sync = function() {

  var headers = this._header.getAllHeaders();
  var size = headers.size - 1;

  if (this._tip.height < size) {

    log.info('Blocks download progress: ' + this._tip.height + '/' +
      this._numNeeded + '  (' + (this._tip.height / this._numNeeded*100).toFixed(2) + '%)');

    var endHash = Array.from(headers)[ Math.min(this._tip.height + BlockService.MAX_BLOCKS, size) ][0];

    this._p2p.getBlocks({ startHash: this._tip.hash, endHash: endHash });
    return;
  }

};

BlockService.prototype._updateChainInfo = function(block, state) {

  var prevHash = block.toHeaders().toJSON().prevBlock;

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
    this._chainTips.push(block.rhash());
  } else {

    incompleteChainIndexes.sort().reverse();
    for(var i = 0; i < incompleteChainIndexes.length; i++) {
      var incompleteIndex = incompleteChainIndexes[i];
      this._chainTips.push(this._incompleteChains[incompleteIndex][0].rhash());
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

  var prevHash = block.toHeaders().toJSON().prevBlock;
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
    var lastEntryPrevHash = lastEntry.toHeaders().toJSON().prevBlock;
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
