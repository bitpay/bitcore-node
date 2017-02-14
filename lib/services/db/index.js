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

  this.subscriptions = {
    transaction: [],
    block: []
  };

  this._sync = new Sync(this.node, this);
}

util.inherits(DB, Service);

DB.dependencies = ['bitcoind'];

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
  if (!fs.existsSync(this.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);
  this.store = levelup(this.dataPath, { db: this.levelupStore, keyEncoding: 'binary', valueEncoding: 'binary'});

  this._sync.on('error', function(err) {
    log.error(err);
  });

  this._sync.on('reorg', function(block) {
    log.warn('Reorg detected! Tip: ' + self.tip.hash +
      ' Concurrent tip: ' + self.concurrentTip.hash +
      ' Bitcoind tip: ' + self.node.services.bitcoind.tiphash);

    self.reorg = true;

    var reorg = new Reorg(self.node, self);
    reorg.handleReorg(block, function(err) {
      if(err) {
        log.error('Reorg failed! ' + err);
        return self.node.stop(function() {});
      }

      log.warn('Reorg successful! Tip: ' + self.tip.hash +
        ' Concurrent tip: ' + self.concurrentTip.hash +
        ' Bitcoind tip: ' + self.node.services.bitcoind.tiphash
      );

      self.reorg = false;
      self._sync.sync();
    });
  });

  this._sync.on('synced', function() {
    log.permitWrites = true;
    log.info('Initial sync complete');
  });

  this.node.on('stopping', function() {
    self._sync.stop();
  });

  this.node.once('ready', function() {
    log.permitWrites = false;
    self._sync.initialSync();

    self.node.services.bitcoind.on('tip', function() {
      self._sync.sync();
    });
  });

  async.series([
    function(next) {
      self._checkVersion(next);
    },
    function(next) {
      self._setVersion(next);
    }
  ], function(err) {
    if (err) {
      return callback(err);
    }
    self.loadTip(function(err) {
      if (err) {
        return callback(err);
      }

      self.loadConcurrentTip(callback);
    });
  });
};

DB.prototype.stop = function(callback) {
  var self = this;
  async.whilst(function() {
    return self.bitcoindSyncing;
  }, function(next) {
    setTimeout(next, 10);
  }, function() {
    self.store.close(callback);
  });
};

DB.prototype.close = function(callback) {
  this.store.close(callback);
};

DB.prototype.getAPIMethods = function() {
  return [];
};

DB.prototype.loadTip = function(callback) {
  var self = this;

  self.store.get(self.dbPrefix + 'tip', self.dbOptions, function(err, tipData) {
    if(err && err instanceof levelup.errors.NotFoundError) {
      self.tip = self.genesis;
      self.tip.__height = 0;
      self.connectBlock(self.genesis, function(err) {
        if(err) {
          return callback(err);
        }

        self.emit('addblock', self.genesis);
        callback();
      });
      return;
    } else if(err) {
      return callback(err);
    }

    var hash = tipData.slice(0, 32).toString('hex');
    var height = tipData.readUInt32BE(32);

    var times = 0;
    async.retry({times: 3, interval: self.retryInterval}, function(done) {
      self.node.services.bitcoind.getBlock(hash, function(err, tip) {
        if(err) {
          times++;
          log.warn('Bitcoind does not have our tip (' + hash + '). Bitcoind may have crashed and needs to catch up.');
          if(times < 3) {
            log.warn('Retrying in ' + (self.retryInterval / 1000) + ' seconds.');
          }
          return done(err);
        }

        done(null, tip);
      });
    }, function(err, tip) {
      if(err) {
        log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
        log.warn('Please reindex your database.');
        return callback(err);
      }

      tip.__height = height;
      self.tip = tip;

      callback();
    });
  });
};

DB.prototype.loadConcurrentTip = function(callback) {
  var self = this;

  self.store.get(self.dbPrefix + 'concurrentTip', self.dbOptions, function(err, tipData) {
    if(err && err instanceof levelup.errors.NotFoundError) {
      self.concurrentTip = self.genesis;
      self.concurrentTip.__height = 0;
      return;
    } else if(err) {
      return callback(err);
    }

    var hash = tipData.slice(0, 32).toString('hex');
    var height = tipData.readUInt32BE(32);

    var times = 0;
    async.retry({times: 3, interval: self.retryInterval}, function(done) {
      self.node.services.bitcoind.getBlock(hash, function(err, concurrentTip) {
        if(err) {
          times++;
          log.warn('Bitcoind does not have our concurrentTip (' + hash + ').' +
           ' Bitcoind may have crashed and needs to catch up.');
          if(times < 3) {
            log.warn('Retrying in ' + (self.retryInterval / 1000) + ' seconds.');
          }
          return done(err);
        }

        done(null, concurrentTip);
      });
    }, function(err, concurrentTip) {
      if(err) {
        log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
        log.warn('Please reindex your database.');
        return callback(err);
      }

      concurrentTip.__height = height;
      self.concurrentTip = concurrentTip;

      callback();
    });
  });
};

DB.prototype.getPublishEvents = function() {
  return [
    {
      name: 'db/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'db/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];
};

DB.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
};

DB.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
};

DB.prototype.connectBlock = function(block, callback) {
  var self = this;

  log.debug('DB handling new chain block');
  var operations = [];
  self.getConcurrentBlockOperations(block, true, function(err, ops) {
    if(err) {
      return callback(err);
    }

    operations = ops;

    self.getSerialBlockOperations(block, true, function(err, ops) {
      if(err) {
        return callback(err);
      }

      operations = operations.concat(ops);

      operations.push(self.getTipOperation(block, true));
      operations.push(self.getConcurrentTipOperation(block, true));

      self.store.batch(operations, callback);
    });
  });
};

DB.prototype.disconnectBlock = function(block, callback) {
  var self = this;

  log.debug('DB removing chain block');
  var operations = [];
  self.getConcurrentBlockOperations(block, false, function(err, ops) {
    if(err) {
      return callback(err);
    }

    operations = ops;

    self.getSerialBlockOperations(block, false, function(err, ops) {
      if(err) {
        return callback(err);
      }

      operations = operations.concat(ops);

      operations.push(self.getTipOperation(block, false));
      operations.push(self.getConcurrentTipOperation(block, false));

      self.store.batch(operations, callback);
    });
  });
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
