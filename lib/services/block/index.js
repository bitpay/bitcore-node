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
    ['getBlock', this, this.getBlock, 1],
    ['getRawBlock', this, this.getRawBlock, 1],
    ['getBlockOverview', this, this.getBlockOverview, 1],
    ['getBestBlockHash', this, this.getBestBlockHash, 0],
    ['syncPercentage', this, this.syncPercentage, 0],
    ['isSynced', this, this.isSynced, 0]
  ];
  return methods;
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

  this._getBlock(hash, function(err, block) {

    if (err) {
      return callback(err);
    }

    var header = block.toHeaders().toJSON();

    var blockOverview = {
      hash: block.rhash(),
      version: block.version,
      confirmations: null,
      height: header.height,
      chainWork: header.chainwork,
      prevHash: header.prevBlock,
      nextHash: null,
      merkleRoot: block.merkleroot,
      time: block.ts,
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
    }
  ], function(err, tip) {

    if(err) {
      return callback(err);
    }

    assert(tip.height >= 0, 'tip is not initialized');
    self._setTip(tip);
    self._setListeners();
    self._startSubscriptions();
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

BlockService.prototype._findCommonAncestor = function(hash, allHeaders, callback) {

  var self = this;
  var count = 0;
  var _oldTip = this._tip.hash;
  var _newTip = hash;
  var oldBlocks = [];

  assert(_oldTip, 'We don\'t have a tip hash to reorg away from!');

  async.whilst(
    // test case
    function() {

      return _oldTip !== _newTip && ++count < allHeaders.size;

    },
    // get block
    function(next) {

      // old tip (our current tip) has to be in database
      self._db.get(self._encoding.encodeBlockKey(_oldTip), function(err, data) {

        if (err || !data) {
          return next(err || new Error('missing block'));
        }

        // once we've found the old tip, we will find its prev and check to see if matches new tip's prev
        var block = self._encoding.decodeBlockValue(data);
        // apply the block's height
        var blockHdr = allHeaders.get(block.rhash());
        if (!blockHdr) {
          return next(new Error('Could not find block in list of headers: ' + block.rhash()));
        }
        block.height = blockHdr.height;
        assert(block.height >= 0, 'We mamaged to save a header with an incorrect height.');

        // apply the block's timestamp
        self._timestamp.getTimestamp(block.rhash(), function(err, timestamp) {

          if (err || !timestamp) {
            return next(err || new Error('missing timestamp'));
          }

          block.ts = timestamp;
          // we will squirrel away the block because our services will need to remove it after we've found the common ancestor
          oldBlocks.push(block);

          // this is our current tip's prev hash
          _oldTip = bcoin.util.revHex(block.prevBlock);

          // our current headers have the correct state of the chain, so consult that for its prev aash
          var header = allHeaders.get(_newTip);

          if (!header) {
            return next(new Error('Header missing from list of headers'));
          }

          // set new tip to the prev hash
          _newTip = header.prevHash;

          next();

        });
      });

    }, function(err) {

      if (err) {
        return callback(err);
      }

      var commonAncestorHash = _newTip;
      callback(null, commonAncestorHash, oldBlocks);

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

BlockService.prototype._handleReorg = function(hash, allHeaders, block) {

  // hash is the hash of the new block that we are reorging to.
  assert(hash, 'We were asked to reorg to a non-existent hash.');
  var self = this;

  self._reorging = true;

  log.warn('Block Service: Chain reorganization detected! Our current block tip is: ' +
    self._tip.hash + ' the current block: ' + hash + '.');

  self._findCommonAncestor(hash, allHeaders, function(err, commonAncestorHash, oldBlocks) {

    if (err) {

      log.error('Block Service: A common ancestor block between hash: ' +
        self._tip.hash + ' (our current tip) and: ' + hash +
        ' (the forked block) could not be found. Bitcore-node must exit.');

      self.node.stop();
      return;
    }

    var commonAncestorHeader = allHeaders.get(commonAncestorHash);

    log.info('Block Service: A common ancestor block was found to at hash: ' + commonAncestorHeader.hash);

    self._processReorg(commonAncestorHeader, oldBlocks, block);

  });


};

// this JUST rewinds the chain back to the common ancestor block, nothing more
BlockService.prototype._onReorg = function(commonAncestorHeader, oldBlockList, newBlock) {

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

  self._db.batch(removalOps, function() {

        self._reorging = false;

        if (newBlock) {
          self._onBlock(newBlock);
        }
  });

};

BlockService.prototype._onAllHeaders = function() {
  this._startSync();
};


BlockService.prototype._processReorg = function(commonAncestorHeader, oldBlocks, newBlock) {

  var self = this;
  var operations = [];
  var services = self.node.services;

  async.eachSeries(
    services,
    function(mod, next) {
      if(mod.onReorg) {
        mod.onReorg.call(mod, [commonAncestorHeader, oldBlocks], function(err, ops) {
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
        if (!self.node.stopping) {
          log.error('Block Service: Error: ' + err);
          self.node.stop();
        }
        return;
      }

      self._db.batch(operations, function(err) {

        if (err && !self.node.stopping) {
            log.error('Block Service: Error: ' + err);
            self.node.stop();
        }

        self._onReorg(commonAncestorHeader, oldBlocks, newBlock);


      });
    }
  );
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
        if (!self.node.stopping) {
          log.error('Block Service: Error: ' + err);
          self.node.stop();
        }
        return;
      }

      self._db.batch(operations, function(err) {

        if (err) {
          if (!self.node.stopping) {
            log.error('Block Service: Error: ' + err);
            self.node.stop();
          }
          return;
        }

        self._tip.height = self._tip.height + 1;
        self._tip.hash = block.rhash();
        var tipOps = utils.encodeTip(self._tip, self.name);

        self._db.put(tipOps.key, tipOps.value, function(err) {

          if (err) {
            if (!self.node.stopping) {
              log.error('Block Service: Error: ' + err);
              self.node.stop();
            }
            return;
          }

          self._sync();
        });
      });
    }
  );
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

BlockService.prototype._onBlock = function(block) {

  if (this.node.stopping || this._reorging) {
    return;
  }

  // this service must receive blocks in order
  var prevHash = bcoin.util.revHex(block.prevBlock);
  if (this._tip.hash !== prevHash) {
    return;
  }
  log.debug('Block Service: new block: ' + block.rhash());
  block.height = this._tip.height + 1;
  this._processBlock(block);

};

BlockService.prototype._setListeners = function() {

  var self = this;
  self._header.once('headers', self._onAllHeaders.bind(self));
  self._header.on('reorg', function(hash, headers, block) {
    if (!self._reorging && !this._initialSync) {
      log.debug('Block Service: detected a reorg from the header service.');
      self._handleReorg(hash, headers, block);
    }
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

BlockService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost-block'});
  }

  this._bus.on('header/block', this._onBlock.bind(this));
  this._bus.subscribe('header/block');
};

BlockService.prototype._sync = function() {

  var self = this;


  if (self.node.stopping) {
    return;
  }

  var lastHeaderIndex = self._header.getLastHeader().height;

  if (self._tip.height < lastHeaderIndex) {

    if (self._tip.height % 144 === 0) {
      log.info('Block Service: Blocks download progress: ' +
        self._tip.height + '/' + lastHeaderIndex +
        '  (' + self._syncPercentage() + '%)');
    }

    return self._header.getNextHash(self._tip, function(err, hash) {

      if(err) {
        log.error(err);
        self.node.stop();
        return;
      }

      self._p2p.getBlocks({ startHash: self._tip.hash, endHash: hash });
    });

  }

  this._header.blockServiceSyncing = false;
  log.info('Block Service: The best block hash is: ' + self._tip.hash +
    ' at height: ' + self._tip.height);

};

module.exports = BlockService;
