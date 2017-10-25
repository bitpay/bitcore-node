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

  this._tip = null;
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._header = this.node.services.header;
  this._timestamp = this.node.services.timestamp;

  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._initialSync = false;
  this._serviceIniting = false;
  this._blocksInQueue = 0;
  this._recentBlockHashesCount = options.recentBlockHashesCount || 50; // if you expect this chain to reorg deeper than 50, set this
  this._recentBlockHashes = new LRU(this._recentBlockHashesCount);
  this._readAheadBlockCount = options.readAheadBlockCount || 2; // this is the number of blocks to direct the p2p service to read aheead
  this._mempool = this.node.services.mempool;
};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'timestamp', 'p2p', 'db', 'header', 'mempool' ];

// --- public prototype functions
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

    if (header.hash === self._tip.hash) {
      log.info('Block Service: saved tip is good to go.');
      return callback();
    }

    self._findCommonAncestorAndBlockHashesToRemove(function(err, commonAncestorHeader, hashesToRemove) {

      if (err) {
        return callback(err);
      }

      self._handleReorg(commonAncestorHeader, hashesToRemove, callback);
    });

  });
};

BlockService.prototype._findCommonAncestorAndBlockHashesToRemove = function(callback) {

  var self = this;

  var hashes = [{
    hash: self._tip.hash,
    height: self._tip.height
  }];

  var header;
  var iterCount = 0;

  async.until(function() {

    return header || iterCount++ >= self._recentBlockHashesCount;

  }, function(next) {

    var hash = self._recentBlockHashes.get(hash);

    hashes.push({
      tip: hash,
      height: hashes[hashes.length - 1].height - 1
    });

    self._header.getBlockHeader(hash, function(err, _header) {

      if (err) {
        return next(err);
      }

      header = _header;
      next();
    });

  }, function(err) {

    if (err) {
      return callback(err);
    }

    // ensure the common ancestor hash is not in the blocks to remove hashes
    hashes.pop();
    assert(hashes.length >= 1, 'Block Service: we expected to remove at least one block, but we did not have at least one block.');
    callback(null, header, hashes);

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

  async.times(Math.min(self._tip.height, self._recentBlockHashesCount), function(n, next) {

    self.getBlock(hash, function(err, block) {

      if (err) {
        return callback(err);
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

    log.info('Block Service: loaded: ' + self._recentBlockHashesCount + ' hashes from the index.');
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

// --- start private prototype functions

BlockService.prototype._detectReorg  = function(block) {
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
      return setImmediate(next);
    }

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

  // at this point, we need to ensure the block header is in a very specific state
  // 1. we should have no listeners of any kind that could cause side effects
  // 2. we should have no pending events, yet to be fired, after this routine yields

  self._initialSync = true;
  self._serviceIniting = true;

  self._removeAllSubscriptions();

  // this should ensure that any handlers, yet to be fired, will fire
  setImmediate(function() {
    self._onHeaders(callback);
  });

};

BlockService.prototype._onHeaders = function(callback) {

  var self = this;

  self._serviceIniting = false;

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

      // check to see if our current tip matches what the header service has.
      // if this is a reorg during our initial block sync, it is especially important
      // to see if we've synced past where the reorg/fork took place.
      self._checkTip(function(err) {

        if(err) {
          return callback(err);
        }

        // we've checked the tip, handled any reorg for ourselves, and we are ready to
        // sync any new blocks that might exist after our tip
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

BlockService.prototype._handleReorg = function(commonAncestorHeader, hashesToRemove, callback) {

  var self = this;

  // we want to ensure that we can reask for previously delievered inventory
  self._p2p.clearInventoryCache();

  log.warn('Block Service: chain reorganization detected, current height/hash: ' + self._tip.height + '/' +
    self._tip.hash + ' common ancestor hash: ' + commonAncestorHeader.hash + ' at height: ' + commonAncestorHeader.height);

  async.series([
    self._setTip.bind(self, { hash: commonAncestorHeader.hash, height: commonAncestorHeader.height }),
    self._processReorg.bind(self, commonAncestorHeader, hashesToRemove),
  ], callback);

};

BlockService.prototype._processReorg = function(commonAncestorHeader, hashesToRemove, callback) {

  var self = this;
  var operations = [];
  var blockCount = 0;
  var bar = new utils.IndeterminateProgressBar();

  log.info('Block Service: Processing the reorganization.');

  async.eachSeries(hashesToRemove, function(tip, next) {

      if (process.stdout.isTTY) {
        bar.tick();
      }

      self._getReorgBlock(tip, function(err, block) {

        if (err || !block)  {
          return next(err || new Error('Block Service: block should be in the index.'));
        }

        self._onReorg(commonAncestorHeader.hash, block, function(err, ops) {

          if (err) {
            return next(err);
          }

          blockCount++;
          operations = operations.concat(ops);
          self._recentBlockHashes.del(tip.hash);
          next();
        });

      });
  }, function(err) {

    if (err) {
      return callback(err);
    }

    log.info('Block Service: removed ' + blockCount + ' block(s) during the reorganization event.');
    self._db.batch(_.compact(_.flattenDeep(operations)), callback);

  });
};

BlockService.prototype._getReorgBlock = function(tip, callback) {

  var self = this;

  self._getBlock(tip.hash, function(err, block) {

    if (err || !block) {
      return callback(err || new Error('block not found for reorg.'));
    }

    self._timestamp.getTimestamp(tip.hash, function(err, timestamp) {

      if (err || !timestamp) {
        return callback(err || new Error('timestamp missing from reorg.'));
      }

      block.__height = tip.height;
      block.__ts = timestamp;
      callback(null, block);
    });

  });

};

BlockService.prototype._onBlock = function(block, callback) {

  var self = this;

  if (self._reorging || self._serviceIniting) {
    return callback();
  }

  self._getBlock(block.rhash(), function(err, _block) {

    if(err) {
      return self._handleError(err);
    }

    if (_block) {
      log.debug('Block Service: not syncing, block already in database.');
      return setImmediate(callback);
    }

    self._processBlock(block, callback);

  });
};

BlockService.prototype._processBlock = function(block, callback) {

  var self = this;

  if (self.node.stopping) {
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
      return callback(err);
    }

    self._db.batch(_.compact(_.flattenDeep(ops)), function(err) {

      if (err) {
        return callback(err);
      }

      self._recentBlockHashes.set(block.rhash(), bcoin.util.revHex(block.prevBlock));
      self._setTip({ hash: block.rhash(), height: self._tip.height + 1 }, callback);

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

  if (this._serviceIniting) {
    return;
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

  if (self.node.stopping) {
    return;
  }

  log.debug('Block Service: querying header service for next block using tip: ' + self._tip.hash);

  self._header.getEndHash(self._tip, self._readAheadBlockCount, function(err, targetHash, endHash) {

    if(err) {
      return self._handleError(err);
    }

    if (!targetHash && !endHash) {
      return self.emit('synced');
    }

    // to ensure that we can receive blocks that were previously delivered
    // this will lead to duplicate transactions being sent
    self._p2p.clearInventoryCache();

    // if we don't get our callback called in due time,
    // then we must assume we've reorg'ed very shortly after
    // we made this call and we should re-compute where we are
    self._getBlocksTimer = setTimeout(function() {
      self.emit('next block');
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
