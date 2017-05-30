'use strict';

var BaseService = require('../../service');
var levelup = require('levelup');
var bitcore = require('bitcore-lib');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var BufferUtil = bitcore.util.buffer;
var Reorg = require('./reorg');
var async = require('async');
var BlockHandler = require('./block_handler');
var LRU = require('lru-cache');
var utils = require('../../utils');
var _ = require('lodash');
var constants = require('../../constants');

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
  this._blockHeaderQueue = LRU(50); //hash -> header, height -> header,
  this._blockQueue = LRU(10); // keep 10 blocks in the cache in case of reorg's
};

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'bitcoind',
  'db'
];

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

BlockService.prototype.stop = function(callback) {
  if (callback) {
    setImmediate(callback);
  }
};

BlockService.prototype._sync = function() {

  var self = this;
  async.waterfall([

    self._loadTips.bind(self),
    self._detectStartupReorg.bind(self),
    self._getBlocks.bind(self)

  ], function(err, blocksDiff) {

    if(err) {
      log.error(err);
      self.node.stop();
    }

    if (blocksDiff > 0) {
      return self._blockHandler.sync();
    }

    self._startSubscriptions();
  });

};

BlockService.prototype.printTipInfo = function(prependedMessage) {

  log.info(
    prependedMessage + ' Serial Tip: ' + this.tip.hash +
    ' Concurrent tip: ' + this.concurrentTip.hash +
    ' Network tip: ' + this.bitcoind.tiphash
  );

};

BlockService.prototype.getNetworkTipHash = function() {
  return this.bitcoind.tiphash;
};

BlockService.prototype.getBlockOperations = function(block, add, type, callback) {
  var operations = [];

  async.each(
    this.node.services,
    function(mod, next) {

      var fn = mod.blockHandler;

      if (type === 'concurrent') {
        fn = mod.concurrentBlockHandler;
      }

      if (fn) {

        fn.call(mod, block, add, function(err, ops) {

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

BlockService.prototype.getBlocks = function(blockArgs, callback) {

  var self = this;

  async.mapLimit(blockArgs, 8, function(blockArg, next) {

    async.waterfall([

        self._isGenesisBlock.bind(self, blockArg),

        function(block, next) {

         if (block) {
            return next(null, self.genesis);
          }

          self._getBlock(blockArg, next);
        }
    ], next);

  }, function(err, blocks) {

    if(err) {
      return callback(err);
    }

    self._detectReorg(blocks, function(reorgHash, reorgHeight) {

      // if we have reorg'ed, we want to retain the block's hash in our
      // index, but we want to mark it as "-REORG"
      var reorgOperations = self._getReorgOperations(reorgHash, reorgHeight);

      var headers = [];
      var tipIndexHeight = self.tip.__height;

      for(var i = 0; i < blocks.length; i++) {

        var block = blocks[i];
        if (block.__height !== ++tipIndexHeight) {
          block.height = tipIndexHeight;
          block.__height = tipIndexHeight;
          self._blockQueue.set(block.hash, block);
        }

        headers.push({
          hash: block.hash,
          prevHash: utils.reverseBufferToString(block.header.prevHash),
          height: tipIndexHeight
        });

      }

      var operations = self._getBlockOperations(headers);

      if (reorgOperations) {
        operations = reorgOperations.concat(operations);
      }

      self.db.batch(operations, function(err) {
        callback(err, blocks);
      });

    });

  });

};

BlockService.prototype.getBlockHeader = function(blockArg, callback) {

  var self = this;
  var header = self._blockHeaderQueue.get(blockArg);

  if (header) {
    return setImmediate(function() {
      callback(null, header);
    });
  }

  self.bitcoind.getBlockHeader(blockArg, function(err, header) {

    if(err) {
      return callback(err);
    }

    self._setBlockHeaderQueue(header);
    callback(null, header);

  });
};


BlockService.prototype.getBlockHash = function(height, callback) {

  this._getBlockValue(height, callback);

};

BlockService.prototype.getBlockHeight = function(hash, callback) {

  this._getBlockValue(hash, callback);

};

BlockService.prototype._startSubscriptions = function() {

  var self = this;

  if (!self._subscribed) {

    self._subscribed = true;
    self.bus = self.node.openBus({remoteAddress: 'localhost'});

    self.bus.on('bitcoind/rawblock', function(block) {

      log.info('New block received: ' + block.hash + ' at height: ' + block.height);
      self._cacheRawBlock(block);
      var header = self._getHeader(block);
      self._setBlockHeaderQueue(header);

      self._detectReorg([block], function() {
        self._blockHandler.sync(block);
      });

    });

    self.bus.subscribe('bitcoind/rawblock');
  }

};

BlockService.prototype._cacheRawBlock = function(block) {
  log.debug('Setting block: ' + block.hash + ' in the raw block cache.');
  this._blockQueue.set(block.hash, block);
};

BlockService.prototype._getBlocks = function(callback) {

  var self = this;
  var blocksDiff = self.bitcoind.height - self.tip.__height;

  // we will need to wait for new blocks to be pushed to us
  if (blocksDiff < 0) {
      log.warn('Peer\'s height is less than our own. The peer may be syncing. ' +
        'The system is usable, but the chain may have a reorg in future blocks. ' +
         'You should not rely on query responses for heights greater than ' +
          self.bitcoind.height + ' until fully synced.');

      return callback(null, blocksDiff);
  }

  log.info('Syncing: ' + blocksDiff + ' blocks from the network.');

  var operations = [];

  async.timesLimit(blocksDiff, 8, function(n, next) {

    var blockNumber = n + self.tip.__height + 1;

    self.getBlockHeader(blockNumber, function(err, header) {

      if(err) {
        return next(err);
      }

      self._getBlockOperations(header).forEach(function(op) {
        operations.push(op);
      });

      next();
    });

  }, function(err) {

    if(err) {
      return callback(err);
    }

    self.db.batch(operations, function(err) {

      if (err) {
        return callback(err);
      }

      log.info('Completed syncing block headers from the network.');
      callback(null, blocksDiff);
    });

  });
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

BlockService.prototype._setBlockHeaderQueue = function(header) {

  this._blockHeaderQueue.set(header.height, header);
  this._blockHeaderQueue.set(header.hash, header);

};

BlockService.prototype._setHandlers = function() {
  var self = this;

  self.node.once('ready', function() {

    self._sync();

  });

  self._blockHandler.on('synced', function() {

    log.info('Synced: ' + self.tip.hash);
    self._startSubscriptions();

  });
};

BlockService.prototype._getGenesisBlock = function() {

  this.genesis = {};
  this.genesis.height = 0;
  this.genesis.hash = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];
  return this.genesis;

};

BlockService.prototype._detectStartupReorg = function(callback) {

  var self = this;

  if (self.tip.height === 0) {
    return callback();
  }

  self.getBlockHeader(hash, function(err, header) {

    if (err) {
      return callback(err);
    }

    if (header.height === height) {
      return callback();
    }

    var opts = { preReorgTipHash: hash, preReorgTipHeight: header.height };
    self._handleReorg(header.hash, opts, callback);

  });
};

BlockService.prototype._handleReorg = function(hash, callback) {

  var self = this;
  self.printTipInfo('Reorg detected!');

  self.reorg = true;
  self.emit('reorg');

  var reorg = new Reorg(self.node, self);

  reorg.handleReorg(hash, function(err) {

    if(err) {
      log.error('Reorg failed! ' + err);
      self.node.stop();
    }

    self.printTipInfo('Reorg successful!');
    self.reorg = false;
    self.cleanupAfterReorg(callback);

  });

};

BlockService.prototype._decodeTipData = function(tipDataBuf) {
  var hash = tipDataBuf.slice(0, 32).toString('hex');
  var height = tipDataBuf.slice(32).toString('hex').readUInt32BE();
  return {
    hash: hash,
    height: height
  };
};

BlockService.prototype._loadTips = function(callback) {

  var self = this;

  var tipStrings = ['tip', 'concurrentTip'];

  async.each(tipStrings, function(tip, next) {

    self.db.get(self.dbPrefix + tip, self.dbOptions, function(err, tipData) {

      if(err && !(err instanceof levelup.errors.NotFoundError)) {
        return next(err);
      }

      if (!tipData) {
        self[tip] = self._getGenesisBlock();
        return next();
      }

      self[tip] = self._decodeTipData(tipData);
      log.info('loaded ' + tip + ' hash: ' + self[tip].hash + ' height: ' + self[tip].height);
      next();

    });

  }, function(err) {

    if(err) {
      return callback(err);
    }

    log.info('Bitcoin network tip is currently: ' + self.bitcoind.tiphash + ' at height: ' + self.bitcoind.height);
    callback();

  });

};

BlockService.prototype._detectReorg = function(blocks, callback) {

  var tipHash = this.reorgHash || this.tip.hash;
  var tipHeight = this.reorgHeight || this.tip.__height;

  for(var i = 0; i < blocks.length; i++) {

    if (blocks[i].__height === 0) {
      continue;
    }

    var prevHash = utils.reverseBufferToString(blocks[i].header.prevHash);
    if (prevHash !== tipHash) {
      var opts = { preReorgTipHash: tipHash, preReorgTipHeight: tipHeight };
      return this._handleReorg(prevHash, opts, callback);
    }

    tipHash = blocks[i].hash;
    tipHeight = blocks[i].__height;
  }

  this.reorgHash = tipHash;
  this.reorgHeight = tipHeight;
  callback();

};

BlockService.prototype._getBlockValue = function(hashOrHeight, callback) {

  var self = this;

  var key, valueFn;

  if (hashOrHeight.length < 64) {
    key = self.encoding.encodeBlockHeightKey(parseInt(hashOrHeight));
    valueFn = self.encoding.decodeBlockHashValue.bind(self.encoding);
  } else {
    key = self.encoding.encodeBlockHashKey(hashOrHeight);
    valueFn = self.encoding.decodeBlockHeightValue.bind(self.encoding);
  }

  self.db.get(key, function(err, buf) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback();
    }
    if (err) {
      return callback(err);
    }
    callback(null, valueFn(buf));
  });

};

BlockService.prototype._isGenesisBlock = function(blockArg, callback) {

  if (blockArg.length === 64) {

    return this._getBlockValue(blockArg, function(err, value) {

      if (err) {
        return callback(null, false);
      }

      if (value === 0) {
        return callback(null, true);
      }

      callback(null, false);

    });

  }

  setImmediate(function() {

    if (blockArg === 0) {
      return callback(null, true);
    }
    callback(null, false);
  });

};

BlockService.prototype._getBlock = function(blockArg, callback) {

  var self = this;

  var cachedBlock = self._blockQueue.get(blockArg);
  if (cachedBlock) {
    return setImmediate(function() {
      callback(null, cachedBlock);
    });
  }

  self.bitcoind.getBlock(blockArg, function(err, block) {

    if(err) {
      return callback(err);
    }

    if (blockArg.length === 64) {
      return self.getBlockHeader(blockArg, function(err, header) {

        if(err) {
          return callback(err);
        }

        block.__height = header.height;
        block.height = header.height;
        callback(null, block);

      });
    }

    block.__height = blockArg;
    block.height = blockArg;
    callback(null, block);
  });
};

BlockService.prototype._getReorgOperations = function(hash, height) {

  if (!hash || !height) {
    return;
  }

  var self = this;

  var heightKey = self.encoding.encodeBlockHeightKey(height);
  var hashKey = self.encoding.encodeBlockHashKey(hash);
  var heightValue = self.encoding.encodeBlockHeightValue(height);
  var newHashKey = self.encoding.encodeBlockHashKey(hash + '-REORG');
  var newHashValue = self.encoding.encodeBlockHashValue(hash + '-REORG');

  return [
    { action: 'del', key: heightKey },
    { action: 'del', key: hashKey },
    { action: 'put', key: newHashKey, value: heightValue },
    { action: 'put', key: heightKey, value: newHashValue }
  ];

};

BlockService.prototype._getBlockOperations = function(obj) {

  var self = this;

  if (_.isArray(obj)) {
    var ops = [];
    _.forEach(obj, function(block) {
      ops.push(self._getBlockOperations(block));
    });
    return _.flatten(ops);
  }

  var operations = [];

  operations.push({
    type: 'put',
    key: self.encoding.encodeBlockHashKey(obj.hash),
    value: self.encoding.encodeBlockHeightValue(obj.height)
  });

  operations.push({
    type: 'put',
    key: self.encoding.encodeBlockHeightKey(obj.height),
    value: self.encoding.encodeBlockHashValue(obj.hash)
  });

  return operations;

};


module.exports = BlockService;
