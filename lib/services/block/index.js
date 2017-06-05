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
  this.p2p = this.node.services.p2p;
  this.db = this.node.services.db;
  this.subscriptions = {};
  this.subscriptions.block = [];
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
  this._lastReportedTime = Date.now();
};

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'p2p',
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

BlockService.prototype.getAPIMethods = function() {
  var methods = [
    ['processBlockOperations', this, this.processBlockOperations, 1]
  ];
  return methods;
};

BlockService.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'block/' + name, 'total:', this.subscriptions[name].length);
};

BlockService.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
  log.info(emitter.remoteAddress, 'unsubscribe:', 'block/' + name, 'total:', this.subscriptions[name].length);
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

BlockService.prototype._sync = function() {

  var self = this;
  self._startSubscriptions();

};

BlockService.prototype.printTipInfo = function(prependedMessage) {

  log.info(
    prependedMessage + ' Serial Tip: ' + this.tip.hash +
    ' Concurrent tip: ' + this.concurrentTip.hash
  );

};

BlockService.prototype._reportStatus = function(serviceName) {

  var tip = this.tips[serviceName];

  if ((Date.now() - this._lastReportedTime) > 1000) {
    this._lastReportedTime = Date.now();
    log.info(serviceName + ' sync: current height is: ' + tip.height +
      ' - hash is: ' + tip.hash);
  }

};

BlockService.prototype.processBlockOperations = function(opts, callback) {

  if (!_.isArray(opts.operations)) {
    return;
  }

  // TODO: when writing to leveldb, it turns out that the optimal batch size to write to the
  // database is 1000 bytes to achieve optimal write performance on most systems.
  // This is not a comprehensive study, however and certainly not for other db types.
  var self = this;

  self.db.batch(opts.operations, function(err) {

    if(err) {
      return callback(err);
    }

    if (!opts.serviceName) {
      opts.serviceName = 'unknown';
    }

    self.setTip(opts);
    self._reportStatus(opts.serviceName);

    callback();
  });

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

BlockService.prototype.getBlocks = function(startHash, endHash, callback) {
};

BlockService.prototype._getBlocks = function(startHash, endHash, callback) {

  var self = this;
  assert(startHash && startHash.length === 64, 'startHash is required to getBlocks');

  self.p2p.getBlocks({ startHash: startHash, endHash: endHash });

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

BlockService.prototype._checkCache = function(key, cache) {
  return cache.get(key);
};

BlockService.prototype.getBlockHeader = function(hash, callback) {

  var self = this;
  var header = self._checkCache(hash, self._blockHeaderQueue);

  if (header) {
    return callback(null, header);
  }

  self.p2p.getBlockHeaders(hash);
  var timer = setInterval(function() {
    var header = self._checkCache(hash, self._blockHeaderQueue);
    if (header) {
      clearInterval(timer);
      callback(null, header);
    }
  }, 250);
  timer.unref();
};

BlockService.prototype.getBlockHash = function(height, callback) {

  this._getBlockValue(height, callback);

};

BlockService.prototype.getBlockHeight = function(hash, callback) {

  this._getBlockValue(hash, callback);

};

BlockService.prototype._startSubscriptions = function() {

  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self.bus = self.node.openBus({remoteAddress: 'localhost'});

  self.bus.on('p2p/block', self._onBlock.bind(self));
  self.bus.on('p2p/headers', self._onHeaders.bind(self));

  self.bus.subscribe('p2p/block');
  self.bus.subscribe('p2p/headers');

};

BlockService.prototype._onHeaders = function(headers) {
  log.debug('New header received: ' + block.hash);
  this._cacheHeaders(headers);
};

BlockService.prototype._onBlock = function(block) {

  log.debug('New block received: ' + block.hash);

  this._cacheBlock(block);
  this._broadcast(this.subscriptions.block, 'block/block', block);
};

BlockService.prototype._broadcast = function(subscribers, name, entity) {
  for (var i = 0; i < subscribers.length; i++) {
    subscribers[i].emit(name, entity);
  }
};

BlockService.prototype._cacheBlock = function(block) {

  log.debug('Setting block: ' + block.hash + ' in the block cache.');
  this._blockQueue.set(block.hash, block);

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

  self.p2p.once('bestHeight', function(height) {

    self._bestHeight = height;
    self._loadTip(self._sync);

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
