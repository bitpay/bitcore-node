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

var BlockService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._db = this.node.services.db;
  this._p2p = this.node.services.p2p;
  this._header = this.node.services.header;
  this._timestamp = this.node.services.timestamp;

  this._subscriptions = {};
  this._subscriptions.block = [];
  this._subscriptions.reorg = [];

  this._blockCount = 0;
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._initialSync = true;
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
        nextHash: null,
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

BlockService.prototype.getRawBlock = function(hash, callback) {
  this.getBlock(hash, function(err, block) {
    if(err) {
      return callback(err);
    }
    callback(null, block.toRaw().toString('hex'));
  });
};

BlockService.prototype._checkTip = function(callback) {
  // check to see if our own tip is no longer in the main chain
  // (there was a reorg while we were shut down)
  var self = this;

  self._header.getBlockHeader(self._tip.height, function(err, header) {

    if (err || !header) {
      return callback(err || new Error('Header at height: ' + self._tip.height + ' was not found.'));
    }

    if (header.hash === self._tip.hash) {
      return callback();
    }

    // means the header service no longer tracks our tip on the main chain
    // so we should consider ourselves in a reorg situation
    self._header.getAllHeaders(function(err, headers) {

      if(err || !headers) {
        return callback(err || new Error('All headers not found.'));
      }

      self._handleReorg(header.hash, headers, callback);

    });

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

    assert(tip.height >= 0, 'tip is not initialized');
    self._setTip(tip);
    self._setListeners();
    callback();

  });

};

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
};

BlockService.prototype.subscribe = function(name, emitter) {

  this._subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'block/' + name, 'total:', this._subscriptions[name].length);

};

BlockService.prototype._syncPercentage = function() {
  var height = this._header.getLastHeader().height;
  var ratio = this._tip.height/height;
  return (ratio*100).toFixed(2);
};

BlockService.prototype.syncPercentage = function(callback) {
  callback(null, this._syncPercentage());
};

BlockService.prototype.unsubscribe = function(name, emitter) {

  var index = this._subscriptions[name].indexOf(emitter);

  if (index > -1) {
    this._subscriptions[name].splice(index, 1);
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'block/' + name, 'total:', this._subscriptions[name].length);

};

// --- start private prototype functions

BlockService.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

BlockService.prototype._detectReorg  = function(block) {
  var prevHash = bcoin.util.revHex(block.prevBlock);
  if (this._tip.hash !== prevHash) {
    return true;
  }
  return false;
};

BlockService.prototype._getOldHeaders = function(commonAncestorHeader, allHeaders) {

  var header = allHeaders.get(this._tip.hash);
  assert(header, 'Header needed to find old blocks during reorg.');
  var headers = [];

  while (header.height > commonAncestorHeader.height) {
    headers.push(header);
    header = allHeaders.get(header.prevHash);
  }

  return headers;

};

BlockService.prototype._findCommonAncestor = function(hash, allHeaders, callback) {

  // the prev hash of the passed in "hash" should also point to a block who has the same prev hash.

  var self = this;

  var reorgHeader = allHeaders.get(hash);
  assert(reorgHeader, 'No reorg header found, cannot find common ancestor.');

  var prevHash = reorgHeader.prevHash;

  self.getBlock(prevHash, function(err, block) {

    if (err) {
      return callback(err);
    }

    var commonAncestorHeader = allHeaders.get(block.rhash());
    callback(null, commonAncestorHeader);
  });
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

    this._header.getHeaderByHeight(blockArg, function(err, header) {

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

BlockService.prototype._handleReorg = function(reorgHash, allHeaders, callback) {

  var self = this;

  var reorgHeader = allHeaders.get(reorgHash);
  assert(reorgHeader, 'We were asked to reorg to a non-existent hash.');

  self._findCommonAncestor(reorgHash, allHeaders, function(err, commonAncestorHeader) {

    if (err) {
      return callback(err);
    }

    assert(commonAncestorHeader, 'A common ancestor hash was found, but its header could not he found.');

    // if we are syncing and we haven't sync'ed to the common ancestor hash, we can safely ignore this reorg
    if (self._tip.height < commonAncestorHeader.height) {
      return callback();
    }

    var reorgHeaders = self._getOldHeaders(commonAncestorHeader, allHeaders);

    assert(reorgHeaders, 'Expected to have reorg headers to remove');

    log.info('Block Service: A common ancestor block was found to at hash: ' + commonAncestorHeader.hash +
      ' and height: ' + commonAncestorHeader.height + '. Removing a total of: ' + reorgHeaders.length + ' block(s).');

    self._processReorg(commonAncestorHeader, reorgHeaders, function(err) {

      if(err) {
        return callback(err);
      }

      callback();

    });

  });

};

// this JUST rewinds the chain back to the common ancestor block, nothing more
BlockService.prototype._onReorg = function(commonAncestorHeader, oldBlockList, callback) {

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var self = this;
  self._setTip({ hash: commonAncestorHeader.hash, height: commonAncestorHeader.height });
  var tipOps = utils.encodeTip(self._tip, self.name);

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];

  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.push({
      type: 'del',
      key: self._encoding.encodeBlockKey(block.rhash()),
    });
  });

  self._db.batch(removalOps, callback);

};

BlockService.prototype._onAllHeaders = function() {
  // once the header service has all of its headers, we know we can check our
  // own tip for consistency and make sure our it is on the mainchain
  var self = this;

  if (!self._initialSync) {
    return self._sync();
  }

  self._checkTip(function(err) {

    if(err) {
      log.error(err);
      return self.node.stop();
    }

    self._startSync();

  });

};

BlockService.prototype._processReorg = function(commonAncestorHeader, reorgHeaders, callback) {
  var self = this;
  var operations = [];
  var services = self.node.services;

  // process one block at a time just in case we have a huge amount of blocks to back out
  async.eachSeries(reorgHeaders, function(header, next) {

    async.waterfall([
      function(next) {
        self.getBlock(header.hash, next);
      },
      function(block, next) {
        if (!block) {
          return next(new Error('block not found for reorg.'));
        }
        self._timestamp.getTimestamp(header.hash, function(err, timestamp) {
          if (err || !timestamp) {
            return next(err || new Error('timestamp missing from reorg.'));
          }
          block.__height = header.height;
          block.__ts = timestamp;
          next(null, block);
        });
      },
      function(block, next) {
        async.eachSeries(services, function(mod, next) {
          if(mod.onReorg) {
            mod.onReorg.call(mod, [commonAncestorHeader, [block]], function(err, ops) {
              if (err) {
                return next(err);
              }
              if (ops) {
                operations = operations.concat(ops);
              }
              self._onReorg(commonAncestorHeader, [block], next);
            });
          } else {
            setImmediate(next);
          }
        }, next);
      }
    ], next);
  }, function(err) {

    if (err) {
      return callback(err);
    }

    self._db.batch(operations, callback);

  });

};

BlockService.prototype._processBlock = function(block) {

  var self = this;
  var operations = [];
  var services = self.node.services;

  async.eachSeries(
    services,
    function(mod, next) {
      if(mod.onBlock) {
        mod.onBlock.call(mod, block, function(err, ops) {
          if (err) {
            return next(err);
          }
          if (ops) {
            operations = operations.concat(ops);
          }
          next();
        });
      } else {
        setImmediate(next);
      }
    },

    function(err) {

      if (err) {
        return self._handleError(err);
      }

      self._db.batch(operations, function(err) {

        if (err) {
          return self._handleError(err);
        }

        self._tip.height = self._tip.height + 1;
        self._tip.hash = block.rhash();
        var tipOps = utils.encodeTip(self._tip, self.name);

        self._db.put(tipOps.key, tipOps.value, function(err) {

          if (err) {
            return self._handleError(err);
          }

          self._syncing = false;
          self._reorging = false;
          self._sync();
        });
      });
    }
  );
};

BlockService.prototype._handleError = function(err) {
  if (!this.node.stopping) {
    log.error('Block Service: ' + err);
    return this.node.stop();
  }
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

BlockService.prototype.newBlock = function(block) {

 if (this.node.stopping || this._tip.hash === block.rhash()) {
    return;
  }

  // this service must receive blocks in order
  var prevHash = bcoin.util.revHex(block.prevBlock);

  if (this._tip.hash !== prevHash) {
    return log.warn('received a block that was not asked for and not linked directly to our tip.');
  }

  log.debug('Block Service: new block: ' + block.rhash());
  block.__height = this._tip.height + 1;
  this._processBlock(block);

};

BlockService.prototype._setListeners = function() {
  this._header.on('headers', this._onAllHeaders.bind(this));
};

BlockService.prototype.newReorg = function(block, headers, callback) {
  var self = this;
  self._reorging = true;
  log.info('Block Service: detected a reorg from the header service.');
  self._handleReorg(block.rhash(), headers, function(err) {
    if (err) {
      return callback(err);
    }
    self.newBlock(block);

    async.retry({ interval: 100, times: 1000 }, function(next) {
      next(self._reorging);
    }, function(err) {
      if (err) {
        return callback(err);
      }
      callback();
    });

  });
};

BlockService.prototype._setTip = function(tip) {
  log.debug('Block Service: Setting tip to height: ' + tip.height);
  log.debug('Block Service: Setting tip to hash: ' + tip.hash);
  this._tip = tip;
};

BlockService.prototype._startSync = function() {

  this._numNeeded = this._header.getLastHeader().height - this._tip.height;

  log.info('Block Service: Gathering: ' + this._numNeeded + ' block(s) from the peer-to-peer network.');

  this._sync();
};

BlockService.prototype._sync = function() {

  var self = this;

  if (self.node.stopping || self._syncing) {
    return;
  }

  self._syncing = true;

  var lastHeaderIndex = self._header.getLastHeader().height;

  if (self._tip.height < lastHeaderIndex) {

    if (self._tip.height % 144 === 0) {
      log.info('Block Service: Blocks download progress: ' +
        self._tip.height + '/' + lastHeaderIndex +
        '  (' + self._syncPercentage() + '%)');
    }

    return self._header.getNextHash(self._tip, function(err, targetHash, nextHash) {

      if(err) {
        log.error(err);
        self.node.stop();
        return;
      }

      self._header.lastBlockQueried = targetHash;

      // to ensure that we can receive blocks that were previously delivered
      // this will lead to duplicate transactions being sent
      self._p2p.clearInventoryCache();

console.log('target hash: ' + targetHash);
      self._p2p.getP2PBlock({
        filter: {
          startHash: self._tip.hash,
          endHash: nextHash
        },
        blockHash: targetHash
      }, self.newBlock.bind(self));

    });

  }

  this._syncing = false;
  this._initialSync = false;
  log.info('Block Service: The best block hash is: ' + self._tip.hash +
    ' at height: ' + self._tip.height);

};

module.exports = BlockService;
