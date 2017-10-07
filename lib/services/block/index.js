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

var BlockService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._header = this.node.services.header;
  this._timestamp = this.node.services.timestamp;

  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._initialSync = false;
  this._reorgBackToBlock = null; // use this to rewind your indexes to a specific point by height or hash
  this._timeOfLastBlockReport = Date.now() - 30000;
  this._blocksInQueue = 0;
};

inherits(BlockService, BaseService);

BlockService.dependencies = [ 'timestamp', 'p2p', 'db', 'header' ];

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

BlockService.prototype._reorgBackTo = function(callback) {
  var self = this;
  self._header.getBlockHeader(self._reorgBackToBlock, function(err, header) {
    if (err || !header) {
      return callback(err || new Error('Header not found to reorg back to.'));
    }
    log.info('Block Service: we found the block to reorg back to, commencing reorg...');
    self._handleReorg(header, callback);
  });
};

BlockService.prototype._checkTip = function(callback) {

  var self = this;

  log.info('Block Service: checking the saved tip...');

  if (self._reorgBackToBlock) {
    self._reorgBackToBlock = false;
    log.warn('Block Service: we were asked to reorg back to block: ' + self._reorgBackToBlock);
    return self._reorgBackTo(callback);
  }

  self._header.getBlockHeader(self._tip.height, function(err, header) {

    if (err) {
      return callback(err);
    }

    header = header || self._header.getLastHeader();

    if (header.hash === self._tip.hash) {
      log.info('Block Service: saved tip is good to go.');
      return callback();
    }

    self._findCommonAncestor(function(err, commonAncestorHeader) {
      if(err) {
        return callback(err);
      }
      self._handleReorg(commonAncestorHeader, callback);
    });

  });
};

BlockService.prototype._findCommonAncestor = function(callback) {

  var self = this;
  var hash = self._tip.hash;
  var header;

  async.until(function() {

    return header;

  }, function(next) {

    self._getBlock(hash, function(err, block) {

      if (err || !block) {
        return callback(err || new Error('Block Service: went looking for the tip block, but found nothing.'));
      }

      hash = bcoin.util.revHex(block.prevBlock);

      self._header.getBlockHeader(hash, function(err, _header) {

        if (err) {
          return next(err);
        }

        header = _header;
        next();
      });
    });
  }, function(err) {

    if (err) {
      return callback(err);
    }

    callback(null, header);
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

      self._setTip(tip, callback);
    });

  });

};

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
};

BlockService.prototype._getTimeSinceLastBlock = function(blockHash, prevBlockHash, callback) {

  var self = this;

  async.map([ blockHash, prevBlockHash ], function(hash, next) {
    self._timestamp.getTimestamp(hash, next);
  }, function(err, times) {
    if (err) {
      return callback(err);
    }
    return callback(null, utils.convertMillisecondsToHumanReadable((times[0] * 1000) - (times[1] * 1000)));
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
};

BlockService.prototype.onHeaders = function(callback) {

  var self = this;

  // this fires under 2 conditions:
  // 1. on initial boot right after all headers are synced by the header service
  // 2. right after the header service handles a reorg

  self._initialSync = true;

  self._removeAllSubscriptions();

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

BlockService.prototype._handleReorg = function(commonAncestorHeader, callback) {

  var self = this;

  // we want to ensure that we can reask for previously delievered inventory
  self._p2p.clearInventoryCache();

  log.warn('Block Service: chain reorganization detected, current height/hash: ' + self._tip.height + '/' +
    self._tip.hash + ' common ancestor hash: ' + commonAncestorHeader.hash + ' at height: ' + commonAncestorHeader.height);

  var oldTip = { height: self._tip.height, hash: self._tip.hash };

  async.series([
    self._setTip.bind(self, { hash: commonAncestorHeader.hash, height: commonAncestorHeader.height }),
    self._processReorg.bind(self, commonAncestorHeader, oldTip),
  ], callback);

};

BlockService.prototype._processReorg = function(commonAncestorHeader, oldTip, callback) {

  var self = this;
  var operations = [];
  var tip = oldTip;
  var blockCount = 0;
  var bar = new utils.IndeterminateProgressBar();

  log.info('Block Service: Processing the reorganization.');

  if (commonAncestorHeader.hash === tip.hash) {
    return callback(null, []);
  }

  async.whilst(

    function() {

      if (process.stdout.isTTY) {
        bar.tick();
      }
      return tip.hash !== commonAncestorHeader.hash;

    },

    function(next) {

      async.waterfall([

        self._getReorgBlock.bind(self, tip),

        function(block, next) {

          tip = {
            hash: bcoin.util.revHex(block.prevBlock),
            height: tip.height - 1
          };

          next(null, block);

        },

        function(block, next) {
          self._onReorg(commonAncestorHeader.hash, block, next);
        }

      ], function(err, ops) {

        if(err) {
          return next(err);
        }

        blockCount++;
        operations = operations.concat(ops);
        next();

      });
    },

    function(err) {

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

  if (self._reorging) {
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

  self._saveBlock(block, function(err) {

    if(err) {
      return self._handleError(err);
    }

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

BlockService.prototype._logSynced = function(blockHash) {

  var self = this;

  if (self._reorging) {
    return;
  }

  var blockHeight;
  var timeDiff;

  async.waterfall([
    function(next) {
      self._header.getBlockHeader(blockHash, function(err, header) {
        if (err) {
          return next(err);
        }

        if (!header) {
          return next();
        }

        blockHeight = header.height;
        next(null, header.prevHash);
      });
    },
    function(prevBlockHash, next) {

      if (!prevBlockHash) {
        return next();
      }

      self._getTimeSinceLastBlock(blockHash, prevBlockHash, function(err, diff) {

        if (err) {
          return self._handleError(err);
        }

        timeDiff = diff;
        next();
      });
    }
  ], function(err) {

    if (err) {
      return self._handleError(err);
    }

    log.info('Block Service: The best block hash is: ' + blockHash +
      ' at height: ' + blockHeight + '. Time between the last 2 blocks (adjusted): ' + timeDiff);

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
};

BlockService.prototype._startSync = function() {

  var numNeeded = Math.max(this._header.getLastHeader().height - this._tip.height, 0);

  log.info('Block Service: Gathering: ' + numNeeded + ' block(s) from the peer-to-peer network.');

  if (numNeeded > 0) {
    this.on('next block', this._sync.bind(this));
    this.on('synced', this._onSynced.bind(this));
    clearInterval(this._reportInterval);
    this._reportingInterval = setInterval(this._reportStatus.bind(this), 5000);
    return this._sync();
  }

  this._onSynced();

};

BlockService.prototype._reportStatus = function() {
  if (this._tip.height % 144 === 0 || Date.now() - this._timeOfLastBlockReport > 10000) {
    this._timeOfLastBlockReport = Date.now();
    this._logProgress();
  }
};

BlockService.prototype._sync = function() {

  var self = this;

  if (self.node.stopping) {
    return;
  }

  if (self._currentQuery === self._tip.hash) {
    return;
  }

  self._currentQuery = self._tip.hash;

  self._header.getNextHash(self._tip, function(err, targetHash, nextHash) {

    if(err) {
      return self._handleError(err);
    }

    // to ensure that we can receive blocks that were previously delivered
    // this will lead to duplicate transactions being sent
    self._p2p.clearInventoryCache();

    // if we don't get our callback called in due time,
    // then we must assume we've reorg'ed very shortly after
    // we made this call and we should re-compute where we are
    self._getBlocksTimer = setTimeout(function() {
      self._currentQuery = null;
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
        endHash: nextHash
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
