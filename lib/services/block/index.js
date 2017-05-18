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
var Sync = require('./sync');

var BlockService = function(options) {
  BaseService.call(this, options);
  this.bitcoind = this.node.services.bitcoind;
  this.db = this.node.services.db;
  this._sync = new Sync(this.node, this);
  this.syncing = true;
  this._lockTimes = [];
};

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'bitcoind',
  'db'
];

BlockService.prototype._log = function(msg, fn) {
  if (!fn) {
    return log.info('BlockService: ', msg);
  }

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

BlockService.prototype._setHandlers = function() {
  var self = this;
  self.node.once('ready', function() {

    self.genesis = Block.fromBuffer(self.bitcoind.genesisBuffer);
    self._loadTips(function(err) {

      if(err) {
        throw err;
      }

      self._log('Bitcoin network tip is currently: ' + self.bitcoind.tiphash + ' at height: ' + self.bitcoind.height);
      self._sync.sync();

    });

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

BlockService.prototype.detectReorg = function(blocks) {

  var self = this;

  if (!blocks || blocks.length === 0) {
    return;
  }

  var tipHash = self.reorgTipHash || self.tip.hash;
  var chainMembers = [];

  var loopIndex = 0;
  var overallCounter = 0;

  while(overallCounter < blocks.length) {

    if (loopIndex >= blocks.length) {
      overallCounter++;
      loopIndex = 0;
    }

    var prevHash = BufferUtil.reverse(blocks[loopIndex].header.prevHash).toString('hex');
    if (prevHash === tipHash) {
      tipHash = blocks[loopIndex].hash;
      chainMembers.push(blocks[loopIndex]);
    }
    loopIndex++;

  }

  for(var i = 0; i < blocks.length; i++) {
    if (chainMembers.indexOf(blocks[i]) === -1) {
      return blocks[i];
    }
    self.reorgTipHash = blocks[i].hash;
  }

};

BlockService.prototype.handleReorg = function(forkBlock, callback) {

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
