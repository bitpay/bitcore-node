'use strict';

var util = require('util');
var fs = require('fs');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var Networks = bitcore.Networks;
var Block = bitcore.Block;
var $ = bitcore.util.preconditions;
var index = require('../../');
var log = index.log;
var Service = require('../../service');
var Sync = require('./sync');
var Reorg = require('./reorg');
var Block = bitcore.Block;
var utils = require('../../utils');

 /*
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 * @param {Node} options.store - A levelup backend store
 */
function DB(options) {
  /* jshint maxstatements: 20 */

  if (!(this instanceof DB)) {
    return new DB(options);
  }
  if (!options) {
    options = {};
  }

  Service.call(this, options);

  this.version = 2;

  this.dbPrefix = '\u0000\u0000';
  this.tip = null;
  this.genesis = null;
  this.dbOptions = {
    keyEncoding: 'string',
    valueEncoding: 'binary'
  };

  $.checkState(this.node.network, 'Node is expected to have a "network" property');
  this.network = this.node.network;

  this._setDataPath();

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.retryInterval = 60000;

  this.subscriptions = {};

  this._sync = new Sync(this.node, this);
  this.syncing = true;
  this.bitcoind = this.node.services.bitcoind;
  this._operationsQueue = [];
  this._lockTimes = [];
}

util.inherits(DB, Service);

DB.dependencies = ['bitcoind'];

DB.prototype.pauseSync = function(callback) {
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

DB.prototype.resumeSync = function() {
  log.debug('Attempting to resume sync');
  var time = this._lockTimes.shift();
  if (this._lockTimes.length === 0) {
    if (time) {
      log.debug('sync lock held for: ' + utils.diffTime(time) + ' secs');
    }
    this._sync.paused = false;
    this._sync.sync();
  }
};

DB.prototype._setDataPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  if (this.node.network === Networks.livenet) {
    this.dataPath = this.node.datadir + '/bitcore-node.db';
  } else if (this.node.network === Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      this.dataPath = this.node.datadir + '/regtest/bitcore-node.db';
    } else {
      this.dataPath = this.node.datadir + '/testnet3/bitcore-node.db';
    }
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

DB.prototype._checkVersion = function(callback) {
  var self = this;

  self.store.get(self.dbPrefix + 'tip', self.dbOptions, function(err) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback();
    } else if (err) {
      return callback(err);
    }
    self.store.get(self.dbPrefix + 'version', self.dbOptions, function(err, buffer) {
      var version;
      if (err instanceof levelup.errors.NotFoundError) {
        version = 1;
      } else if (err) {
        return callback(err);
      } else {
        version = buffer.readUInt32BE();
      }
      if (self.version !== version) {
        var helpUrl = 'https://github.com/bitpay/bitcore-node/blob/master/docs/services/db.md#how-to-reindex';
        return callback(new Error(
          'The version of the database "' + version + '" does not match the expected version "' +
            self.version + '". A recreation of "' + self.dataPath + '" (can take several hours) is ' +
            'required or to switch versions of software to match. Please see ' + helpUrl +
            ' for more information.'
        ));
      }
      callback();
    });
  });
};

DB.prototype._setVersion = function(callback) {
  var versionBuffer = new Buffer(new Array(4));
  versionBuffer.writeUInt32BE(this.version);
  this.store.put(this.dbPrefix + 'version', versionBuffer, callback);
};

DB.prototype.start = function(callback) {
  var self = this;

  if (!fs.existsSync(self.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  self._store = levelup(self.dataPath, { db: self.levelupStore, keyEncoding: 'binary', valueEncoding: 'binary'});

  self.store = {
    get: self._store.get.bind(self._store),
    put: self._store.put.bind(self._store),
    batch: self._store.batch.bind(self._store),
    createReadStream: self._store.createReadStream.bind(self._store),
    createKeyStream: self._store.createKeyStream.bind(self._store),
  };

  self.node.once('ready', function() {

    self.genesis = Block.fromBuffer(self.bitcoind.genesisBuffer);
    self.loadTips(function(err) {

      if(err) {
        throw err;
      }

      self._sync.sync();

    });

  });

  setImmediate(function() {
    self._checkVersion(self._setVersion.bind(self, callback));
  });

};


DB.prototype.detectReorg = function(blocks) {

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

DB.prototype.handleReorg = function(forkBlock, callback) {

  var self = this;
  self.printTipInfo('Reorg detected!');

  self.reorg = true;

  var reorg = new Reorg(self.node, self);

  reorg.handleReorg(forkBlock.hash, function(err) {

    if(err) {
      log.error('Reorg failed! ' + err);
      self.node.stop(function() {});
      throw err;
    }

    self.printTipInfo('Reorg successful!');
    self.reorg = false;
    callback();

  });

};

DB.prototype.printTipInfo = function(prependedMessage) {

  log.info(
    prependedMessage + ' Serial Tip: ' + this.tip.hash +
    ' Concurrent tip: ' + this.concurrentTip.hash +
    ' Bitcoind tip: ' + this.bitcoind.tiphash
  );

};

DB.prototype.stop = function(callback) {
  var self = this;
  self._stopping = true;
  async.whilst(function() {
    return self._operationsQueue > 0;
  }, function(next) {
    setTimeout(next, 10);
  }, function() {
    self.close(callback);
  });
};

DB.prototype.close = function(callback) {
  if (this._store) {
    this._store.close(callback);
  }
};

DB.prototype.getAPIMethods = function() {
  return [];
};

DB.prototype.loadTips = function(callback) {

  var self = this;

  var tipStrings = ['tip', 'concurrentTip'];

  async.each(tipStrings, function(tip, next) {

    self.store.get(self.dbPrefix + tip, self.dbOptions, function(err, tipData) {

      if(err && !(err instanceof levelup.errors.NotFoundError)) {
        return next(err);
      }

      var hash;
      //genesis block, set to -1 because we have no yet processed the blocks
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

        self.bitcoind.getBlockHeader(hash, function(err, header) {

          if(err) {
            return next(err);
          }

          block.__height = header.height;
          self[tip] = block;
          log.info('loaded tip, hash: ' + block.hash + ' height: ' + block.__height);
          next();

        });
      });
    });

  }, callback);

};

DB.prototype.getPublishEvents = function() {
  return [];
};

DB.prototype.getConcurrentBlockOperations = function(block, add, callback) {
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

DB.prototype.getSerialBlockOperations = function(block, add, callback) {
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

DB.prototype.getTipOperation = function(block, add) {
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

DB.prototype.getConcurrentTipOperation = function(block, add) {
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

DB.prototype.getPrefix = function(service, callback) {
  var self = this;

  function getPrefix(next) {
    self.store.get(self.dbPrefix + 'prefix-' + service, function(err, buffer) {
      if(err) {
        if(err.notFound) {
          return next();
        }
        return next(err);
      }
      return callback(null, buffer);
    });
  }

  function getUnused(next) {
    self.store.get(self.dbPrefix + 'nextUnused', function(err, buffer) {
      if(err) {
        if(err.notFound) {
          return next(null, new Buffer('0001', 'hex'));
        }
        return next(err);
      }

      return next(null, buffer);
    });
  }

  function putPrefix(buffer, next) {
    self.store.put(self.dbPrefix + 'prefix-' + service, buffer, function(err) {
      if(err) {
        return next(err);
      }

      next(null, buffer);
    });
  }

  function putUnused(buffer, next) {
    var prefix = buffer.readUInt16BE();
    var nextUnused = new Buffer(2);
    nextUnused.writeUInt16BE(prefix + 1);

    self.store.put(self.dbPrefix + 'nextUnused', nextUnused, function(err) {
      if(err) {
        return next(err);
      }

      return next(null, buffer);
    });
  }

  async.waterfall(
    [
      getPrefix,
      getUnused,
      putPrefix,
      putUnused
    ],
    callback
  );
};

module.exports = DB;
