'use strict';

var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var utils = require('../../utils');
var assert = require('assert');
var constants = require('../../constants');
var bcoin = require('bcoin');
var _ = require('lodash');
var LRU = require('lru-cache');

var BlockService = function(options) {

  BaseService.call(this, options);

  this._subscriptions = {};
  this._subscriptions.block = [];

  this._tip = null;
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._header = this.node.services.header;
  this._timestamp = this.node.services.timestamp;
  this._mempool = this.node.services.mempool;

  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._initialSync = false;
  this._processingBlock = false;

  this._blocksInQueue = 0;
  this._recentBlockHashesCount = options.recentBlockHashesCount || 144; // block service won't reorg past this point
  this._recentBlockHashes = new LRU(this._recentBlockHashesCount);
  this._readAheadBlockCount = options.readAheadBlockCount || 2; // this is the number of blocks to direct the p2p service to read aheead
  this._pauseSync = options.pause;
  this._reorgToBlock = options.reorgToBlock;
};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'timestamp', 'p2p', 'db', 'header', 'mempool' ];

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

BlockService.prototype.getPublishEvents = function() {
  return [
    {
      name: 'block/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];
};

BlockService.prototype.getAPIMethods = function() {
  var methods = [
    ['getInfo', this, this.getInfo, 0],
    ['getBlock', this, this.getBlock, 1],
    ['getRawBlock', this, this.getRawBlock, 1],
    ['getBlockOverview', this, this.getBlockOverview, 1],
    ['getBestBlockHash', this, this.getBestBlockHash, 0],
    ['syncPercentage', this, this.syncPercentage, 0],
    ['isSynced', this, this.isSynced, 0]
  ];
  return methods;
};

BlockService.prototype.getInfo = function(callback) {
  var self = this;
  callback(null, {
    blocks: self.getTip().height,
    connections: self._p2p.getNumberOfPeers(),
    timeoffset: 0,
    proxy: '',
    testnet: self.node.network === 'livenet' ? false: true,
    errors: '',
    network: self.node.network,
    relayFee: 0,
    version: 'bitcore-1.1.2',
    protocolversion: 700001,
    difficulty: self._header.getCurrentDifficulty()
  });
};

BlockService.prototype.isSynced = function(callback) {
  callback(null,  !this._initialSync);
};

BlockService.prototype.getBestBlockHash = function(callback) {
  var hash = this._header.getLastHeader().hash;
  callback(null, hash);
};

BlockService.prototype.getTip = function() {
  return this._tip;
};

BlockService.prototype.getBlock = function(arg, callback) {

  var self = this;
  self._getHash(arg, function(err, hash) {

    if (err) {
      return callback(err);
    }

    if (!hash) {
      return callback();
    }

    self._getBlock(hash, callback);
  });

};

BlockService.prototype.getBlockOverview = function(hash, callback) {

  var self = this;
  self._getBlock(hash, function(err, block) {

    if (err) {
      return callback(err);
    }

    if (!block) {
      return callback();
    }

    self._header.getBlockHeader(hash, function(err, header) {

      if (err) {
        return callback(err);
      }

      var target = bcoin.mining.common.getTarget(header.bits);
      var difficulty = bcoin.mining.common.getDifficulty(target);
      var txids = block.txs.map(function(tx) {
        return tx.txid();
      });

      var blockOverview = {
        hash: block.rhash(),
        version: block.version,
        confirmations: self.getTip().height - header.height + 1,
        height: header.height,
        chainWork: header.chainwork,
        prevHash: header.prevHash,
        nextHash: header.nextHash,
        merkleRoot: header.merkleRoot,
        time: block.ts,
        medianTime: null,
        nonce: header.nonce,
        bits: header.bits,
        difficulty: difficulty,
        txids: txids
      };

      callback(null, blockOverview);
    });
  });

};

BlockService.prototype.getRawBlock = function(hash, callback) {
  this.getBlock(hash, function(err, block) {
    if(err) {
      return callback(err);
    }
    if (!block) {
      return callback();
    }
    callback(null, block.toRaw().toString('hex'));
  });
};

BlockService.prototype._checkTip = function(callback) {

  var self = this;

  log.info('Block Service: checking the saved tip...');

  self._header.getBlockHeader(self._tip.height, function(err, header) {

    if (err) {
      return callback(err);
    }

    header = header || self._header.getLastHeader();

    if (header.hash === self._tip.hash && !self._reorgToBlock) {
      log.info('Block Service: saved tip is good to go.');
      return callback();
    }

    self._handleReorg(callback);

  });
};

BlockService.prototype._resetTip = function(callback) {
  var self = this;

  if (!self._tipResetNeeded) {
    return callback();
  }

  self._tipResetNeeded = false;
  var bar = new utils.IndeterminateProgressBar();

  log.warn('Block Service: resetting tip due to a non-existent tip block...');

  var block;
  var header = self._header.getLastHeader();
  var height = header.height;

  self._header.getAllHeaders(function(err, headers) {

    if (err || !headers) {
      return callback(err || new Error('headers required'));
    }

    log.info('Block Service: retrieved all the headers for lookups.');

    async.until(function() {

      if (process.stdout.isTTY) {
        bar.tick();
      }

      return block;

    }, function(next) {

      self._getBlock(header.hash, function(err, _block) {

        if (err) {
          return callback(err);
        }

	if (!_block) {
          log.debug('Block Service: block: ' + header.hash + ' was not found, proceeding to older blocks.');
	}

        block = _block;
        header = headers.getIndex(--height);
        assert(header, 'Header not found for reset.');

        if (!block) {
          log.debug('Block Service: trying block: ' + header.hash);
        }

        next();

      });

    }, function(err) {

      if (err || !block) {
        return callback(err ||
          new Error('Block Service: none of the blocks from the headers match what is already indexed in the block service.'));
      }

      self._setTip({ hash: block.rhash(), height: height + 1 }, callback);

    });

  });
};

BlockService.prototype._performSanityCheck = function(tip, callback) {

  var self = this;

  if (tip.height === 0) {
    return callback(null, tip);
  }

  // is our tip saved in our database? If not, then find the latest block that is in
  // in our database and set the tip to that
  self._getBlock(tip.hash, function(err, block) {
    if (err) {
      return callback(err);
    }
    if (block) {
      return callback(null, tip);
    }
    return callback(null, false);
  });
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
    }
  ], function(err, tip) {

    if(err) {
      return callback(err);
    }

    self._performSanityCheck(tip, function(err, tip) {

      if (err) {
        return callback(err);
      }

      self._blockProcessor = async.queue(self._onBlock.bind(self));
      self._bus = self.node.openBus({remoteAddress: 'localhost-block'});

      if (!tip) {
        self._tipResetNeeded = true;
        return callback();
      }

      self._header.on('reorg', function() {
        self._reorging = true;
      });

      self._header.on('reorg complete', function() {
        self._reorging = false;
      });

      self._setTip(tip, function(err) {

        if (err) {
          return callback(err);
        }

        self._loadRecentBlockHashes(callback);

      });
    });

  });

};

BlockService.prototype._loadRecentBlockHashes = function(callback) {

  var self = this;
  var hash = self._tip.hash;
  var times = Math.min(self._tip.height, self._recentBlockHashesCount);

  async.timesSeries(times, function(n, next) {

    self.getBlock(hash, function(err, block) {

      if (err || !block) {
        return callback(err || new Error('Block Service: attempted to retrieve block: ' + hash +
          ' but was not in the index.'));
      }

      var prevHash = bcoin.util.revHex(block.prevBlock);
      self._recentBlockHashes.set(hash, prevHash);
      hash = prevHash;
      next();

    });

  }, function(err) {

    if (err) {
      return callback(err);
    }

    assert(self._recentBlockHashes.length === times, 'Block Service: did not load enough recent block hashes from the index.');
    log.info('Block Service: loaded: ' + self._recentBlockHashes.length + ' hashes from the index.');
    callback();

  });

};

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
};

BlockService.prototype._getTimeSinceLastBlock = function(callback) {

  var self = this;

  self._header.getBlockHeader(Math.max(self._tip.height - 1, 0), function(err, header) {

    if(err || !header) {
      return callback(err || new Error('Block Service: we should have a header in order to get time since last block.'));
    }

    async.map([ self._tip.hash, header.hash ], function(hash, next) {
      self._timestamp.getTimestamp(hash, next);
    }, function(err, times) {
      if (err) {
        return callback(err);
      }
      return callback(null, utils.convertMillisecondsToHumanReadable((times[0] * 1000) - (times[1] * 1000)));
    });
  });

};

BlockService.prototype._queueBlock = function(block) {

  var self = this;

  self._blocksInQueue++;

  self._blockProcessor.push(block, function(err) {

    if (err) {
      return self._handleError(err);
    }

    self._logSynced(block.rhash());
    self._blocksInQueue--;

  });

};

BlockService.prototype._syncPercentage = function() {
  var height = this._header.getLastHeader().height;
  var ratio = this._tip.height/height;
  return (ratio*100).toFixed(2);
};

BlockService.prototype.syncPercentage = function(callback) {
  callback(null, this._syncPercentage());
};

BlockService.prototype._detectReorg  = function(block) {
  // a block that is regarded as a "reorging block" could be one that was
  // mined using a previously-orphaned block as its previous block.
  // in this case, we want to completely ignore this block and move on
  return bcoin.util.revHex(block.prevBlock) !== this._tip.hash;
};

BlockService.prototype._getBlock = function(hash, callback) {

  var self = this;

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

BlockService.prototype._getHash = function(blockArg, callback) {

  if (utils.isHeight(blockArg)) {

    this._header.getBlockHeader(blockArg, function(err, header) {

      if(err) {
        return callback(err);
      }

      if (!header) {
        return callback();
      }

      callback(null, header.hash);
    });

  }

  return callback(null, blockArg);

};

BlockService.prototype.onReorg = function(args, callback) {

  var self = this;

  var block = args[1][0];

  var removalOps = [{
    type: 'del',
    key: self._encoding.encodeBlockKey(block.rhash()),
  }];

  setImmediate(function() {
    callback(null, removalOps);
  });
};

BlockService.prototype._onReorg = function(commonAncestorHash, block, callback) {

  var self = this;
  var services = self.node.services;

  async.mapSeries(services, function(service, next) {

    if(!service.onReorg) {
      log.debug('Block Service: skipping reorg for: ' + service.name + ' service.');
      return setImmediate(next);
    }

    log.info('Block Service: Reorging: ' + service.name + ' service.');
    service.onReorg.call(service, [commonAncestorHash, [block]], next);

  }, callback);

};

BlockService.prototype._removeAllSubscriptions = function() {
  this._bus.unsubscribe('p2p/block');
  this._bus.removeAllListeners();
  this.removeAllListeners(); // will remove listeners for 'next block' and 'synced'
  this._subscribedBlock = false;
  if (this._reportInterval) {
    clearInterval(this._reportInterval);
  }
  if (this._getBlocksTimer) {
    clearTimeout(this._getBlocksTimer);
  }
};

BlockService.prototype.onHeaders = function(callback) {

  var self = this;

  if (self._pauseSync) {
    log.warn('Block Service: pausing sync due to config option.');
    return callback();
  }

  // if this service is waiting on block-related callbacks to be fired in the event loop,
  // then we need to wait for the _processingBlock flag to be set to false.
  // when this flag is false, we know we aren't waiting on any new blocks or historical blocks
  // that we asked for, but not yet received
  self._initialSync = true;

  // a heavy block could take a really long time to index
  async.retry({ interval: 1000, times: 100 }, function(next) {
    return next(self._processingBlock);
  }, function(err) {
    if (err) {
      return callback(err);
    }
    self._onHeaders(callback);
  });

};

BlockService.prototype._onHeaders = function(callback) {

  var self = this;

  // check whether or not we need build a new tip (unlikely)
  self._resetTip(function(err) {

    if (err) {
      return callback(err);
    }

    // clear out the blocks queue, if any blocks exist there
    // if this is a reorg sitch, then there may be blocks, but none of
    // them will be saved.
    async.retry(function(next) {

      next(self._blocksInQueue > 0);

    }, function() {

      self._removeAllSubscriptions();

      // check to see if our current tip matches what the header service has.
      // if this is a reorg during our initial block sync, it is especially important
      // to see if we've synced past where the reorg/fork took place.
      self._checkTip(function(err) {

        if(err) {
          return callback(err);
        }

        // we've checked the tip, handled any reorg for ourselves, and we are ready to
        // sync any new blocks that might exist after our tip
        self._reorging = false;
        self._startSync();

        // once we start syncing, we can call back to the header service, so that it can
        // process the next block in its queue.
        callback();

      });
    });
  });

};

BlockService.prototype._startBlockSubscription = function() {

  if (this._subscribedBlock) {
    return;
  }

  this._subscribedBlock = true;

  log.info('Block Service: starting p2p block subscription.');
  this._bus.on('p2p/block', this._queueBlock.bind(this));
  this._bus.subscribe('p2p/block');

};

BlockService.prototype._saveTip = function(tip, callback) {

  var tipOps = utils.encodeTip({
    hash: tip.hash,
    height: tip.height
  }, this.name);

  this._db.put(tipOps.key, tipOps.value, callback);
};

// the header service has the authoritative list of block headers.
// we know we have a tip that is not correct with respect to this.
// so we'll use our recent block hashes cache to find the hash that matches
// into the header service list.
BlockService.prototype._findLatestValidBlockHeader = function(callback) {

  var self = this;

  if (self._reorgToBlock) {
    return self._header.getBlockHeader(self._reorgToBlock, function(err, header) {
      if (err || !header) {
        return callback(err || new Error('Block Service: header not found to reorg to.'));
      }
      callback(null, header);
    });
  }

  var blockServiceHash = self._tip.hash;
  var blockServiceHeight = self._tip.height;
  var iterCount = 0;
  var header;

  async.until(function() {

    return iterCount++ > self._recentBlockHashes.length || header;

  }, function(next) {

    self._header.getBlockHeader(blockServiceHash, function(err, _header) {

      if (err) {
        return next(err);
      }

      var hash = blockServiceHash;
      var height = blockServiceHeight;

      blockServiceHeight--;
      blockServiceHash = self._recentBlockHashes.get(hash);

      if (!_header) {
        // try again with the previous hash of the current hash
        return next();
      }

      // if there was no reorg (the header service just received an orphan block, we should
      // get the header of our tip here.
      if (_header.hash === hash && _header.height === height) {
        header = _header;
        return next();
      }

      next();

    });
  }, function(err) {

    if (err) {
      return callback(err);
    }

    // the header could be undefined
    // this means that the header service has no record of
    // any of our recent block hashes in its indexes.
    // if some joker mines a block using an orphan block as its prev block, then the effect of this will be
    // us detecting a reorg, but not actually reorging anything
    assert(header, 'Block Service: we could not locate any of our recent block hashes in the header service ' +
      'index. Perhaps our header service sync\'ed to the wrong chain?');

    assert(header.height <= self._tip.height, 'Block Service: we found a common ancestor header whose ' +
      'height was greater than our current tip. This should be impossible.');

    callback(null, header);

  });
};

BlockService.prototype._findBlocksToRemove = function(commonHeader, callback) {

  var self = this;
  var hash = self._tip.hash;
  var height = self._tip.height;
  var blocks = [];
  var iterCount = 0;

  async.until(function() {

    return iterCount++ >= self._recentBlockHashes.length || hash === commonHeader.hash;

  }, function(next) {

    self._getBlock(hash, function(err, block) {

      if (err || !block) {
        return next(err || new Error('Block Service: block not found in index.'));
      }

      self._timestamp.getTimestamp(block.rhash(), function(err, timestamp) {

        if (err || !timestamp) {
          return callback(err || new Error('timestamp missing from reorg.'));
        }

        block.__height = height;
        block.__ts = timestamp;

        blocks.push(block);

        hash = bcoin.util.revHex(block.prevBlock);
        height--;

        next();

      });

    });

  }, function(err) {

    if (err) {
      return callback(err);
    }

    callback(null, blocks);

  });

};

BlockService.prototype._handleReorg = function(callback) {

  var self = this;

  // we want to ensure that we can re-ask for previously delievered inventory
  self._p2p.clearInventoryCache();

  var commonAncestorHeader;
  var blocksToRemove;

  async.series([

    function(next) {

      self._findLatestValidBlockHeader(function(err, _commonAncestorHeader) {

        if(err) {
          return next(err);
        }

        // nothing to do, skip and proceed
        if (_commonAncestorHeader.hash === self._tip.hash) {
          return callback();
        }

        commonAncestorHeader = _commonAncestorHeader;
        next();

      });
    },

    function(next) {

      self._findBlocksToRemove(commonAncestorHeader, function(err, _blocksToRemove) {

        if (err) {
          return next(err);
        }

        blocksToRemove = _blocksToRemove;

        assert(blocksToRemove.length >= 1 && blocksToRemove.length <= self._recentBlockHashes.length,
          'Block Service: the number of blocks to remove looks to be incorrect.');

        log.warn('Block Service: chain reorganization detected, current height/hash: ' + self._tip.height + '/' +
          self._tip.hash + ' common ancestor hash: ' + commonAncestorHeader.hash + ' at height: ' + commonAncestorHeader.height +
            ' There are: ' + blocksToRemove.length + ' block(s) to remove.');
        next();
      });
    },

    function(next) {
      self._setTip({ hash: commonAncestorHeader.hash, height: commonAncestorHeader.height }, next);
    },

    function(next) {
      self._processReorg(commonAncestorHeader, blocksToRemove, next);
    }

  ], callback);

};

BlockService.prototype._processReorg = function(commonAncestorHeader, blocksToRemove, callback) {

  var self = this;
  var operations = [];
  var blockCount = 0;
  var bar = new utils.IndeterminateProgressBar();

  async.eachSeries(blocksToRemove, function(block, next) {

    if (process.stdout.isTTY) {
      bar.tick();
    }

    self._onReorg(commonAncestorHeader.hash, block, function(err, ops) {

      if (err) {
        return next(err);
      }

      blockCount++;
      operations = operations.concat(ops);
      self._recentBlockHashes.del(block.rhash());
      next();

    });

  }, function(err) {

    if (err) {
      return callback(err);
    }

    log.info('Block Service: removed ' + blockCount + ' block(s) during the reorganization event.');
    self._db.batch(_.compact(_.flattenDeep(operations)), callback);

  });
};

BlockService.prototype._onBlock = function(block, callback) {

  var self = this;

  if (self._reorging) {
    self._processingBlock = false;
    return callback();
  }

  self._processingBlock = true;

  self._getBlock(block.rhash(), function(err, _block) {

    if(err) {
      self._processingBlock = false;
      return self._handleError(err);
    }

    if (_block) {
      self._processingBlock = false;
      log.debug('Block Service: not syncing, block already in database.');
      return callback();
    }

    self._processBlock(block, callback);

  });
};

BlockService.prototype._processBlock = function(block, callback) {

  var self = this;

  if (self.node.stopping) {
    self._processingBlock = false;
    return callback();
  }

  log.debug('Block Service: new block: ' + block.rhash());

  // common case
  if (!self._detectReorg(block)) {
    return self._saveBlock(block, callback);
  }

  // reorg -- in this case, we will not handle the reorg right away
  // instead, we will skip the block and wait for the eventual call to
  // "onHeaders" function. When the header service calls this function,
  // we will have a chance to clear out our block queue, check our tip,
  // discover where to reorg to, reorg all the services that rely on
  // blocks and sync from there.
  self._processingBlock = false;
  return callback();

};

BlockService.prototype._saveBlock = function(block, callback) {

  var self = this;
  block.__height = self._tip.height + 1;

  var services = self.node.services;

  async.mapSeries(services, function(service, next) {

    if(!service.onBlock) {
      return setImmediate(next);
    }

    service.onBlock.call(service, block, next);

  }, function(err, ops) {

    if (err) {
      self._processingBlock = false;
      return callback(err);
    }

    self._db.batch(_.compact(_.flattenDeep(ops)), function(err) {

      if (err) {
        self._processingBlock = false;
        return callback(err);
      }

      self._recentBlockHashes.set(block.rhash(), bcoin.util.revHex(block.prevBlock));
      self._setTip({ hash: block.rhash(), height: block.__height }, function(err) {
        if (err) {
          self._processingBlock = false;
          return callback(err);
        }
        self._processingBlock = false;

        for (var i = 0; i < self._subscriptions.block.length; i++) {
          self._subscriptions.block[i].emit('block/block', block);
        }

        callback();
      });

    });
  });
};

BlockService.prototype._handleError = function(err) {
  if (!this.node.stopping) {
    log.error('Block Service: handle error ' + err);
    return this.node.stop();
  }
};

BlockService.prototype._syncBlock = function(block) {
  var self = this;

  clearTimeout(self._getBlocksTimer);

  if (self._lastBlockSaved === block.rhash()) {
    self._processingBlock = false;
    return;
  }

  self._saveBlock(block, function(err) {

    if(err) {
      return self._handleError(err);
    }

    self._lastBlockSaved = block.rhash();

    if (self._tip.height < self._header.getLastHeader().height) {
      return self.emit('next block');
    }

    self.emit('synced');

  });
};

BlockService.prototype.onBlock = function(block, callback) {
  var self = this;

  setImmediate(function() {
    callback(null, [{
      type: 'put',
      key: self._encoding.encodeBlockKey(block.rhash()),
      value: self._encoding.encodeBlockValue(block)
    }]);
  });
};

BlockService.prototype._setTip = function(tip, callback) {
  log.debug('Block Service: Setting tip to height: ' + tip.height);
  log.debug('Block Service: Setting tip to hash: ' + tip.hash);
  this._tip = tip;
  this._saveTip(tip, callback);
};

BlockService.prototype._logSynced = function() {

  var self = this;

  if (self._reorging) {
    return;
  }

  self._getTimeSinceLastBlock(function(err, diff) {

    if (err) {
      return self._handleError(err);
    }

    log.info('Block Service: The best block hash is: ' + self._tip.hash +
      ' at height: ' + self._tip.height + '. Time between the last 2 blocks (adjusted): ' + diff);

  });

};

BlockService.prototype._onSynced = function() {
  var self = this;

  if (this._reportInterval) {
    clearInterval(this._reportInterval);
  }

  self._logProgress();
  self._initialSync = false;
  self._startBlockSubscription();
  self._logSynced(self._tip.hash);
  self._mempool.enable();
};

BlockService.prototype._startSync = function() {

  var numNeeded = Math.max(this._header.getLastHeader().height - this._tip.height, 0);

  log.info('Block Service: Gathering: ' + numNeeded + ' block(s) from the peer-to-peer network.');

  if (numNeeded > 0) {
    this.on('next block', this._sync.bind(this));
    this.on('synced', this._onSynced.bind(this));
    clearInterval(this._reportInterval);
    this._reportingInterval = setInterval(this._logProgress.bind(this), 5000);
    return this._sync();
  }

  this._onSynced();

};

BlockService.prototype._sync = function() {

  var self = this;

  if (self.node.stopping || self._reorging) {
    return;
  }

  self._processingBlock = true;

  log.debug('Block Service: querying header service for next block using tip: ' + self._tip.hash);

  self._header.getEndHash(self._tip, self._readAheadBlockCount, function(err, targetHash, endHash) {

    if(err) {
      self._processingBlock = false;
      return self._handleError(err);
    }

    if (!targetHash && !endHash) {
      self._processingBlock = false;
      return self.emit('synced');
    }

    // to ensure that we can receive blocks that were previously delivered
    // this will lead to duplicate transactions being sent
    self._p2p.clearInventoryCache();

    // if we don't get our callback called in due time,
    // then we must assume we've reorg'ed very shortly after
    // we made this call and we should re-compute where we are
    self._getBlocksTimer = setTimeout(function() {
      log.debug('Block Service: block timeout, emitting for next block');
      self._processingBlock = false;
      if (!self._reorging) {
        self.emit('next block');
      }
    }, 5000);

    self._getBlocksTimer.unref();

    // TODO; research how different bitcoin implementation handle block
    // locator objects. If you pass a block locator object that has one
    // block hash and that block hash is not on the main chain, then will
    // the peer send an inv for block 1 or no inv at all?

    self._p2p.getP2PBlock({
      filter: {
        startHash: self._tip.hash,
        endHash: endHash
      },
      blockHash: targetHash
    }, self._syncBlock.bind(self));

  });

};

BlockService.prototype._logProgress = function() {

  if (!this._initialSync) {
    return;
  }

  var progress;
  var bestHeight = Math.max(this._header.getBestHeight(), this._tip.height);

  if (bestHeight === 0) {
    progress = 0;
  } else {
    progress = (this._tip.height/bestHeight*100.00).toFixed(4);
  }

  log.info('Block Service: download progress: ' + this._tip.height + '/' +
    bestHeight + '  (' + progress + '%)');

};

module.exports = BlockService;
