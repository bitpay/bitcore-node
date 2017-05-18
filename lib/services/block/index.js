'use strict';

var assert = require('assert');
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
};

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'bitcoind',
  'db'
];

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
  self._loadTips(function(err) {

    if(err) {
      throw err;
    }

    self._log('Bitcoin network tip is currently: ' + self.bitcoind.tiphash + ' at height: ' + self.bitcoind.height);

    self._detectReorg(function(err, header) {

      if(err) {
        throw err;
      }

      self._handleReorg(header, function


    });

    var blocksDiff = self.bitcoind.height - self.tip.__height - 1;

    if (blocksDiff < 0) {
      self._log('Peer\'s height is less than our own. The peer may be syncing. The system is usable, but chain may have reorg in future blocks from our peers. We may not answer queries about blocks at heights greater than ' + self.bitcoind.height);
      self._blockHandler.sync();
      return;
    }

    self._log('Syncing: ' + blocksDiff + ' blocks from the network.');

    self._getBlocks(blocksDiff, function(err) {

      if(err) {
        throw err;
      }
      self._blockHandler.sync();

    });

  });

};

BlockService.prototype._getBlocks = function(blocksDiff, callback) {

  var self = this;
  var operations = [];

  async.timesLimit(blocksDiff, 8, function(n, next) {

    var blockNumber = n + self.tip.__height + 2;
    self.bitcoind.getBlockHeader(blockNumber, function(err, header) {

      if(err) {
        return next(err);
      }

      operations.push({
        type: 'put',
        key: self.encoding.encodeBlockHashKey(header.hash),
        value: self.encoding.encodeBlockHashValue(header.height)
      });

      operations.push({
        type: 'put',
        key: self.encoding.encodeBlockHeightKey(header.height),
        value: self.encoding.encodeBlockHeightValue(header.hash)
      });

      next();
    });

  }, function(err, headers) {

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

  if (this.tip.__height <= 0) {
    return callback();
  }

  if (this.tip.hash === this.bitcoind.tiphash && this.tip.__height === this.bitcoind.height) {
    return callback();
  }

  self.bitcoind.getBlockHeader(self.tip.__height, function(err, header) {

    if(err) {
      return callback(err);
    }

    if (header.hash === self.tip.hash) {
      return callback();
    }

    callback(null, header);

  });
};

BlockService.prototype.handleReorg = function(header, callback) {

  var self = this;
  self.printTipInfo('Reorg detected!');

  self.reorg = true;

  var reorg = new Reorg(self.node, self);

  reorg.handleReorg(forkBlock.hash, function(err) {

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

  }, callback);

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

BlockService.prototype.getTipOperation = function(block, add) {
  var heightBuffer = new Buffer(4);
  var tipData;

  if(add) {
    heightBuffer.writeUInt32BE(block.__height);
    tipData = Buffer.concat([new Buffer(block.hash, 'hex'), heightBuffer]);
  } else {
    heightBuffer.writeUInt32BE(block.__height - 1);
    tipData = Buffer.concat([BufferUtil.reverse(block.header.prevHash), heightBuffer]);
  }

  return {
    type: 'put',
    key: this.dbPrefix + 'tip',
    value: tipData
  };
};

BlockService.prototype.getConcurrentTipOperation = function(block, add) {
  var heightBuffer = new Buffer(4);
  var tipData;
  if(add) {
    heightBuffer.writeUInt32BE(block.__height);
    tipData = Buffer.concat([new Buffer(block.hash, 'hex'), heightBuffer]);
  } else {
    heightBuffer.writeUInt32BE(block.__height - 1);
    tipData = Buffer.concat([BufferUtil.reverse(block.header.prevHash), heightBuffer]);
  }

  return {
    type: 'put',
    key: this.dbPrefix + 'concurrentTip',
    value: tipData
  };
};

module.exports = BlockService;
