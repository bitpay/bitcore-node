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
  this._latestHeaderHashReceived = null;
  this._heightIndex = null; // tracks block height to block hash
  this._blockHeaderQueue = LRU({
    max: 50,
    length: function(n) {
      return n.length * (1 * 1024 * 1024); // 50 MB of block headers, that should be plenty to hold all the headers
    }
  }); // hash -> header
  this._blockQueue = LRU({
    max: 50,
    length: function(n) {
      return n.length * (1 * 1024 * 1024); // 50 MB of blocks
    }
  }); // hash -> block
  this._chainTips = []; // list of all chain tips, including main chain and any chains that were orphaned after a reorg
  this._maxLookback = 100;
};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'p2p', 'db' ];

BlockService.MAX_CHAINWORK = new BN(1).ushln(256);

// --- public prototype functions
BlockService.prototype.start = function(callback) {

  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self._encoding = new Encoding(self.prefix);
    self._setListeners();
    callback();
  });

};

BlockService.prototype.stop = function(callback) {
  callback();
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

// --- start private prototype functions

BlockService.prototype._applyHeaderHeights = function() {

  var genesis = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];
  this._heightIndex = new Array(this._blockHeaderQueue.length + 1);
  this._heightIndex.push(genesis);

  var _tip = this._latestHeaderHashReceived;
  while (_tip !== genesis) {
    this._heightIndex.push(_tip);
    _tip = this._blockHeaderQueue.get(_tip).prevHash;
  }

};

BlockService.prototype._blockAlreadyProcessed = function(block) {

  return this._blockHeaderQueue.get(block.hash) ? true : false;

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

BlockService.prototype._cacheHeader = function(header) {

  // 1. put a height on the haeder
  header.height = ++this._latestBlockHeight;

  // 2. save to in-memory cache first
  this._blockHeaderQueue.set(header.hash, header.toObject());

  // 3. save to in-memory map block index
  this._heightIndex.push(header);

  // 4. get operations
  return this._getHeaderOperations(header);

};

BlockService.prototype._cacheHeaders = function(headers) {

  var self = this;
  var operations = headers.map(self._cacheHeader.bind(self));
  operations = _.flatten(operations);

  log.debug('Saving: ' + headers.length + ' headers to the database.');
  self._db.batch(operations, function(err) {
    if (!err) {
      self._setHeaderTip();
    }
  });

  self._sync('headers');

};

BlockService.prototype._checkChain = function(tip) {

  var _tip = tip;

  for(var i = 0; i < this._maxLookback; i++) {
    if (_tip === this._tip.hash) {
       return true;
    }
    var prevHeader = this._blockHeaderQueue.get(_tip);
    if (!prevHeader) {
      return false;
    }
    _tip = prevHeader.prevHash;
  }

  return false;

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

BlockService.prototype._findCommonAncestor = function(block) {

  assert(this._chainTips.length > 1,
    'chain tips collection should have at least 2 chains in order to find a common ancestor.');

  var _oldTip = this._tip.hash;
  var _newTip = block.hash;

  assert(_newTip && _oldTip, 'current chain and/or new chain do not exist in our list of chain tips.');

  for(var i = 0; i < this._maxLookback; i++) {

    var oldHdr = this._blockHeaderQueue.get(_oldTip);
    var newHdr = this._blockHeaderQueue.get(_newTip);

    if (!oldHdr || !newHdr) {
      return;
    }

    _oldTip = oldHdr.prevHash;
    _newTip = newHdr.prevHash;

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

  var header = this._blockHeaderQueue.get(tipHash);
  assert(header, 'expected to find a header in block header queue, but did not find any.');

  var prevHeader = this._blockHeaderQueue.get(header.prevHash);
  assert(header, 'expected to find a previous header in block header queue, but did not find any.');

  //we persist the chainWork to avoid recalculating it on boot
  var chainwork = new BN(new Buffer(header.chainwork || '00', 'hex'));

  if (chainwork.gtn(0)) {
    return chainwork;
  }

  var prevChainwork = new BN(new Buffer(prevHeader.chainwork || '00', 'hex'));

  chainwork = this._computeChainwork(header.bits, prevChainwork);

  header.chainwork = chainwork.toBuffer().toString('hex');
  this._blockHeaderQueue.set(tipHash, header);

  return chainwork;
};

BlockService.prototype._getDelta = function(tip) {

  var blocks = [];
  var _tip = tip;

  while (_tip !== this._tip.hash) {
    var hdr = this._blockHeaderQueue.get(_tip);
    var blk = this._blockQueue.get(_tip);
    _tip = hdr.prevHash;
    blocks.push(blk);
  }

  return blocks;

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

BlockService.prototype._getHeaderOperations = function(header) {

  var self = this;

  // header or [header]
  if (_.isArray(header)) {
    var ops = [];
    _.forEach(header, function(h) {
      ops.push(self._getBlockOperations(h));
    });
    return _.flatten(ops);
  }

  var operations = [];

  // hash
  operations.push({
    type: 'put',
    key: self._encoding.encodeHashKey(header.hash),
    value: self._encoding.encodeHeaderValue(header)
  });

  // height
  operations.push({
    type: 'put',
    key: self._encoding.encodeHeightKey(header.height),
    value: self._encoding.encodeHeaderValue(header)
  });

  return operations;

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

  // if any of our ancestors are missing from the queue, then this is an orphan block
  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var pastBlockCount = Math.min(this._maxLookback, this._blockHeaderQueue.length);
  for(var i = 0; i < pastBlockCount; i++) {
    var prevHeader = this._blockHeaderQueue.get(prevHash);
    if (!prevHeader) {
      return true;
    }
    prevHash = prevHeader.prevHash;
  }

  return false;
};

BlockService.prototype._loadHeaders = function(cb) {

  // on initial sync of headers...we don't have block heights with the headers
  // we just have a list of headers that have a prevhash pointer and that's about it
  // we can't be sure that headers have arrived in order, so we can pick the last header
  // that came in and work backwards to the genesis block. If we don't process exactly the
  // number of total blocks, then we know we did not really have the last header and we should try again
  var self = this;
  var start = self._encoding.encodeHashKey(new Array(65).join('0'));
  var end = Buffer.concat([ utils.getTerminalKey(start.slice(0, 3)), start.slice(3) ]);
  var stream = self._db.createReadStream({ gte: start, lt: end });

  stream.on('end', function() {
    cb();
  });

  stream.on('data', function(data) {
    self._blockHeaderQueue.set(self._encoding.decodeHashKey(data.key), self._encoding.decodeHeaderValue(data.value));
  });

  stream.on('error', function(err) {
    cb(err);
  });

};

BlockService.prototype._loadHeights = function(cb) {
  var self = this;
  var start = self._encoding.encodeHeightKey(0);
  var end = self._encoding.encodeHeightKey(0xffffffff);
  var stream = self._db.createReadStream({ gte: start, lte: end });

  stream.on('end', function() {
    cb();
  });

  stream.on('data', function(data) {
    // I think this should stream in-order
    self._heightIndex.push(self._encoding.decodeHeaderValue(data.value).hash);
  });

  stream.on('error', function(err) {
    cb(err);
  });

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

  // 4. determine block state, reorg, orphaned, normal
  var blockState = this._determineBlockState(block);

  // 5. add block hash to chain tips
  this._updateChainTips(block);

  // 6. react to state of block
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

  log.error('Block Service: Error: ' + err.message + ' not recovering.');
  this.node.stop();

};

BlockService.prototype._onHeaders = function(headers) {

  log.debug('New headers received, count: ' + headers.length);
  this._numCompleted += headers.length;
  this._cacheHeaders(headers);
  this._latestHeaderHash = headers[headers.length - 1].hash;

};


BlockService.prototype._onTipBlock = function(tip) {

  var self = this;
  if (tip) {

    self._tip = tip;

  } else {

    self._tip = {
      height: 0,
      hash: constants.BITCOIN_GENESIS_HASH[self.node.getNetworkName()]
    };

  }

  self._startSync('header');

};

BlockService.prototype._reportBootStatus = function() {

  var blockInfoString = utils.getBlockInfoString(this._tip.height, this._bestHeight);

  log.info('Block Service tip is currently height: ' + this._tip.height + ' hash: ' +
    this._tip.hash + ' P2P network best height: ' + this._bestHeight + '. Block Service is: ' +
    blockInfoString);

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

  // it is essential that the activeChainTip be in the same chain as our current tip
  assert(this._checkChain(activeChainTip), 'The chain with the greatest work does not include our current tip.');

  var blocks = this._getDelta(activeChainTip);

  for(var i = 0; i < blocks.length; i++) {
    this._broadcast(this._subscriptions.block, 'block/block', blocks[i]);
  }

  this._setTip(blocks[i-1]);

};

BlockService.prototype._setListeners = function() {

  var self = this;

  self._p2p.once('bestHeight', self._onBestHeight.bind(self));
  self._db.on('error', self._onDbError.bind(self));
  self.on('reorg', self._handleReorg.bind(self));

};

BlockService.prototype._setHeaderTip = function() {
  var index = this._heightIndex;
  var length = index.length;
  this._headerTip = {
    hash: index[length - 1] || constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()],
    height: length || 0
  };
};

BlockService.prototype._setTip = function(block) {
  this._tip.height = block.height;
  this._tip.hash = block.hash;
  this._db.setServiceTip('block', this._tip);
};

BlockService.prototype._startSync = function(type) {

  var currentHeight = type === 'block' ? this._tip.height : 0; //we gather all headers on each boot
  this._numNeeded = this._bestHeight - currentHeight;
  this._numCompleted = currentHeight;
  if (this._numNeeded <= 0) {
    return;
  }

  log.info('Gathering: ' + this._numNeeded + ' ' + type + '(s) from the peer-to-peer network.');

  var hash = this._tip.hash || constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];
  if (type === 'block') {
    this._p2pBlockCallsNeeded = Math.ceil(this._numNeeded / 500);
    this._latestBlockHash = hash;
    this._sync('block');
  } else {
    this._p2pHeaderCallsNeeded = Math.ceil(this._numNeeded / 2000);
    this._latestHeaderHash = hash;
    this._sync('header');
  }

};

BlockService.prototype._startSubscriptions = function() {

  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self._bus = self.node.openBus({remoteAddress: 'localhost'});

  self._bus.on('p2p/block', self._onBlock.bind(self));
  self._bus.on('p2p/headers', self._onHeaders.bind(self));

  self._bus.subscribe('p2p/block');
  self._bus.subscribe('p2p/headers');

};

BlockService.prototype._sync = function(type) {

  var counter, func, obj, name;
  if (type === 'block') {
    counter = --this._p2pBlockCallsNeeded;
    obj = { startHash: this._latestBlockHash };
    func = this._p2p.getBlocks;
    name = 'Blocks';
  } else {
    counter = --this._p2pHeaderCallsNeeded;
    obj = { startHash: this._latestHeaderHash };
    func = this._p2p.getHeaders;
    name = 'Headers';
  }

  if (counter > 0) {

    log.debug(name + '  download progress: ' + this._numCompleted + '/' +
      this._numNeeded + '  (' + (this._numCompleted/this._numNeeded*100).toFixed(2) + '%)');
    func.call(this._p2p, obj);
    return;

  }

  if ('header') {
    // we are done loading headers, proceed to number them
    this._applyHeaderHeights(this._startSync.bind(this, 'block'));
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

module.exports = BlockService;
