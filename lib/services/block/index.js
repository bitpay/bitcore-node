'use strict';

var BaseService = require('../../service');
var levelup = require('levelup');
var bitcore = require('bitcore-lib');
var Block = bitcore.Block;
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var BufferUtil = bitcore.util.buffer;
var utils = require('../../utils');
var Reorg = require('./reorg');
var $ = bitcore.util.preconditions;
var async = require('async');
var BlockHandler = require('./block_handler');

var BlockService = function(options) {
  BaseService.call(this, options);
  this.bitcoind = this.node.services.bitcoind;
  this.db = this.node.services.db;
  this._blockHandler = new BlockHandler(this.node, this);
  this._lockTimes = [];
  this.tip = null;
  this.genesis = null;
  this.dbOptions = {
    keyEncoding: 'string',
    valueEncoding: 'binary'
  };
};

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'bitcoind',
  'db'
];

BlockService.prototype.getNetworkTipHash = function() {
  return this.bitcoind.tiphash;
};

BlockService.prototype._startSubscriptions = function() {

  var self = this;

  if (!self._subscribed) {

    self._subscribed = true;
    self.bus = self.node.openBus({remoteAddress: 'localhost'});

    self.bus.on('bitcoind/hashblock', function() {
      self._blockHandler.sync();
    });

    self.bus.subscribe('bitcoind/hashblock');
  }

};

BlockService.prototype._log = function(msg) {
  return log.info('BlockService: ', msg);
};

BlockService.prototype.start = function(callback) {

  var self = this;

  self.db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    self._setHandlers();
    callback();
  });
};

BlockService.prototype._sync = function() {

  var self = this;
  async.waterfall([

    self._loadTips.bind(self),
    self._detectReorg.bind(self),
    self._getBlocks.bind(self)

  ], function(err) {

    if(err) {
      throw err;
    }

    self._blockHandler.sync();
  });

};

BlockService.prototype._getBlocks = function(callback) {

  var self = this;
  var blocksDiff = self.bitcoind.height - self.tip.__height;

  if (blocksDiff < 0) {
      self._log('Peer\'s height is less than our own. The peer may be syncing.' +
        ' The system is usable, but chain may have a reorg in future blocks.' +
         ' We may not answer queries about blocks at heights greater than ' + self.bitcoind.height);
      self._blockHandler.sync();
      return;
  }

  self._log('Syncing: ' + blocksDiff + ' blocks from the network.');

  var operations = [];

  async.timesLimit(blocksDiff, 8, function(n, next) {

    var blockNumber = n + self.tip.__height + 1;
    self.bitcoind.getBlockHeader(blockNumber, function(err, header) {

      if(err) {
        return next(err);
      }

      operations.push({
        type: 'put',
        key: self.encoding.encodeBlockHashKey(header.hash),
        value: self.encoding.encodeBlockHeightValue(header.height)
      });

      operations.push({
        type: 'put',
        key: self.encoding.encodeBlockHeightKey(header.height),
        value: self.encoding.encodeBlockHashValue(header.hash)
      });

      next();
    });

  }, function(err) {

    if(err) {
      return callback(err);
    }

    self.db.batch(operations, callback);

  });
};

BlockService.prototype._setHandlers = function() {
  var self = this;
  self.node.once('ready', function() {
    self.genesis = Block.fromBuffer(self.bitcoind.genesisBuffer);
    self._sync();
  });

  self._blockHandler.on('synced', function() {
    self._startSubscriptions();
  });
};

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
};

BlockService.prototype.pauseSync = function(callback) {
  var self = this;
  self._lockTimes.push(process.hrtime());
  if (self._sync.syncing) {
    self._sync.once('synced', function() {
      self._sync.paused = true;
      callback();
    });
  } else {
    self._sync.paused = true;
    setImmediate(callback);
  }
};

BlockService.prototype.resumeSync = function() {
  this._log('Attempting to resume sync', log.debug);
  var time = this._lockTimes.shift();
  if (this._lockTimes.length === 0) {
    if (time) {
      this._log('sync lock held for: ' + utils.diffTime(time) + ' secs', log.debug);
    }
    this._sync.paused = false;
    this._sync.sync();
  }
};

BlockService.prototype._detectReorg = function(callback) {

  var self = this;

  if (self.tip.__height <= 0) {
    return callback();
  }

  // all synced
  if (self.tip.hash === self.bitcoind.tiphash && self.tip.__height === self.bitcoind.height) {
    return callback();
  }

  // check if our tip height has the same hash as the network's
  self.bitcoind.getBlockHeader(self.tip.__height, function(err, header) {

    if(err) {
      return callback(err);
    }

    // we still might have a reorg if our tip is greater than the network's
    // we won't know about this until we start syncing
    if (header.hash === self.tip.hash) {
      return callback();
    }

    //our hash isn't in the network chain anymore, we have reorg'ed
    self._handleReorg(header.hash, callback);

  });
};

BlockService.prototype._handleReorg = function(hash, callback) {

  var self = this;
  self.printTipInfo('Reorg detected!');

  self.reorg = true;

  var reorg = new Reorg(self.node, self);

  reorg.handleReorg(hash, function(err) {

    if(err) {
      self._log('Reorg failed! ' + err, log.error);
      self.node.stop(function() {});
      throw err;
    }

    self.printTipInfo('Reorg successful!');
    self.reorg = false;
    callback();

  });

};

BlockService.prototype.printTipInfo = function(prependedMessage) {

  this._log(
    prependedMessage + ' Serial Tip: ' + this.tip.hash +
    ' Concurrent tip: ' + this.concurrentTip.hash +
    ' Bitcoind tip: ' + this.bitcoind.tiphash
  );

};

BlockService.prototype._loadTips = function(callback) {

  var self = this;

  var tipStrings = ['tip', 'concurrentTip'];

  async.each(tipStrings, function(tip, next) {

    self.db.get(self.dbPrefix + tip, self.dbOptions, function(err, tipData) {

      if(err && !(err instanceof levelup.errors.NotFoundError)) {
        return next(err);
      }

      var hash;
      if (!tipData) {
        hash = new Array(65).join('0');
        self[tip] = {
          height: -1,
          hash: hash,
          '__height': -1
        };
        return next();
      }

      hash = tipData.slice(0, 32).toString('hex');

      self.bitcoind.getBlock(hash, function(err, block) {

        if(err) {
          return next(err);
        }

        self[tip] = block;
        self._log('loaded ' + tip + ' hash: ' + block.hash + ' height: ' + block.__height);
        next();

      });
    });

  }, function(err) {

    if(err) {
      return callback(err);
    }

    self._log('Bitcoin network tip is currently: ' + self.bitcoind.tiphash + ' at height: ' + self.bitcoind.height);
    callback();

  });

};

BlockService.prototype.getConcurrentBlockOperations = function(block, add, callback) {
  var operations = [];

  async.each(
    this.node.services,
    function(mod, next) {
      if(mod.concurrentBlockHandler) {
        $.checkArgument(typeof mod.concurrentBlockHandler === 'function', 'concurrentBlockHandler must be a function');

        mod.concurrentBlockHandler.call(mod, block, add, function(err, ops) {
          if (err) {
            return next(err);
          }
          if (ops) {
            $.checkArgument(Array.isArray(ops), 'concurrentBlockHandler for ' + mod.name + ' returned non-array');
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
        return callback(err);
      }

      callback(null, operations);
    }
  );
};

BlockService.prototype.getSerialBlockOperations = function(block, add, callback) {
  var operations = [];

  async.eachSeries(
    this.node.services,
    function(mod, next) {
      if(mod.blockHandler) {
        $.checkArgument(typeof mod.blockHandler === 'function', 'blockHandler must be a function');

        mod.blockHandler.call(mod, block, add, function(err, ops) {
          if (err) {
            return next(err);
          }
          if (ops) {
            $.checkArgument(Array.isArray(ops), 'blockHandler for ' + mod.name + ' returned non-array');
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
        return callback(err);
      }

      callback(null, operations);
    }
  );
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

BlockService.prototype.getBlock = function(height, callback) {

  var self = this;
  if (self.tip.__height >= self.bitcoind.height) {

    // if our block service's tip is ahead of the network tip, then we need to
    // watch for a reorg by getting what we have for the tip hash and comparing it to
    // what the network has.
    return self.db.get(self.encoding.encodeBlockHeightKey(height), function(err, hash) {

      if(err) {
        return callback(err);
      }

      self.bitcoind.getBlock(height, function(res, block) {

        if(err) {
          return callback(err);
        }

        //oh noes! reorg sitch
        if (hash !== block.hash) {

          callback('reorg');
          return self._handleReorg(block.hash, function() {
            self._blockHandler.sync();
          });

        }

        callback(null, block);
      });


    });
  }

  self.bitcoind.getBlock(height, callback);

};


BlockService.prototype.getBlockHash = function(height, callback) {
  var self = this;
  self.db.get(this.encoding.encodeBlockHeightKey(height), function(err, hashBuf) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback();
    }
    if (err) {
      return callback(err);
    }
    callback(null, self.encoding.decodeBlockHashValue(hashBuf));
  });
};

BlockService.prototype.getBlockHeight = function(hash, callback) {
  var self = this;
  self.db.get(this.encoding.encodeBlockHashKey(hash), function(err, heightBuf) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback();
    }
    if (err) {
      return callback(err);
    }
    callback(null, self.encoding.decodeBlockHeightValue(heightBuf));
  });
};

module.exports = BlockService;
