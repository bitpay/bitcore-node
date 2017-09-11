'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var utils = require('../../utils');
var async = require('async');
var BN = require('bn.js');
var consensus = require('bcoin').consensus;
var assert = require('assert');
var constants = require('../../constants');
var bcoin = require('bcoin');

var HeaderService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._hashes = [];

  this.subscriptions = {};
  this.subscriptions.block = [];
  this._checkpoint = options.checkpoint || 2000; // set to -1 to resync all headers.
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._lastHeader = null;
  this.blockServiceSyncing = true;
  this.lastBlockQueried = null;
  this._blockQueue = [];
};

inherits(HeaderService, BaseService);

HeaderService.dependencies = [ 'p2p', 'db' ];

HeaderService.MAX_CHAINWORK = new BN(1).ushln(256);
HeaderService.STARTING_CHAINWORK = '0000000000000000000000000000000000000000000000000000000100010001';

// --- public prototype functions
HeaderService.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'header/' + name, 'total:', this.subscriptions[name].length);
};

HeaderService.prototype.unsubscribe = function(name, emitter) {

  var index = this.subscriptions[name].indexOf(emitter);

  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'header/' + name, 'total:', this.subscriptions[name].length);

};

HeaderService.prototype.getAPIMethods = function() {

  var methods = [
    ['getAllHeaders', this, this.getAllHeaders, 0],
    ['getBestHeight', this, this.getBestHeight, 0],
    ['getBlockHeader', this, this.getBlockHeader, 1]
  ];

  return methods;

};

HeaderService.prototype.getCurrentDifficulty = function() {
  var target = bcoin.mining.common.getTarget(this._lastHeader.bits);
  return bcoin.mining.common.getDifficulty(target);
};

HeaderService.prototype.getAllHeaders = function(callback) {

  var self = this;
  var start = self._encoding.encodeHeaderHeightKey(0);
  var end = self._encoding.encodeHeaderHeightKey(self._tip.height + 1);
  var allHeaders = new utils.SimpleMap();

  var criteria = {
    gte: start,
    lt: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;

  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    var header = self._encoding.decodeHeaderValue(data.value);
    allHeaders.set(header.hash, header, header.height);
  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    callback(null, allHeaders);

  });
};

HeaderService.prototype.getBlockHeader = function(arg, callback) {

  if (utils.isHeight(arg)) {
    return this._getHeader(arg, null, callback);
  }

  return this._getHeader(null, arg, callback);

};

HeaderService.prototype.getBestHeight = function() {
  return this._tip.height;
};

HeaderService.prototype.start = function(callback) {

  var self = this;

  async.waterfall([
    function(next) {
      self._db.getPrefix(self.name, next);
    },
    function(prefix, next) {
      self._encoding = new Encoding(prefix);
      self._db.getServiceTip(self.name, next);
    },
    function(tip, next) {

      self._tip = tip;

      if (self._tip.height === 0) {

        assert(self._tip.hash === self.GENESIS_HASH, 'Expected tip hash to be genesis hash, but it was not.');

        var genesisHeader = {
          hash: self.GENESIS_HASH,
          height: 0,
          chainwork: HeaderService.STARTING_CHAINWORK,
          version: 1,
          prevHash: new Array(65).join('0'),
          timestamp: 1231006505,
          nonce: 2083236893,
          bits: 0x1d00ffff,
          merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
        };

        self._lastHeader = genesisHeader;

        var dbOps = [
          {
            type: 'put',
            key: self._encoding.encodeHeaderHeightKey(0),
            value: self._encoding.encodeHeaderValue(genesisHeader)
          },
          {
            type: 'put',
            key: self._encoding.encodeHeaderHashKey(self.GENESIS_HASH),
            value: self._encoding.encodeHeaderValue(genesisHeader)
          }
        ];

        return self._db.batch(dbOps, next);

      }
      self._getLastHeader(next);
    },
  ], function(err) {

      if (err) {
        return callback(err);
      }

      self._setListeners();
      self._bus = self.node.openBus({remoteAddress: 'localhost-header'});
      self._startHeaderSubscription();

      callback();

  });

};

HeaderService.prototype.stop = function(callback) {

  if (this._headerInterval) {
    clearInterval(this._headerInterval);
    this._headerInterval = null;
  }

  if (this._blockProcessor) {
    clearInterval(this._blockProcessor);
    this._blockProcessor = null;
  }

  callback();

};

HeaderService.prototype._startHeaderSubscription = function() {

  this._bus.on('p2p/headers', this._onHeaders.bind(this));
  this._bus.subscribe('p2p/headers');

};

HeaderService.prototype.getPublishEvents = function() {

  return [
    {
      name: 'header/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];

};

// Called by the p2p network when a block arrives.
// If blocks arrive in rapid succession from the p2p network,
// then this handler could be in the middle of saving a header leading to an erroroneous reorg
HeaderService.prototype._queueBlock = function(_block) {

  var self = this;

  // in all cases, we want to ensure the header is saved
  self._persistHeader(_block, function(err) {

    if (err) {
      log.error(err);
      return self.node.stop();
    }

    if (self.blockServiceSyncing) {
      // if we are syncing, we can broadcast right away
      return self._broadcast(_block);
    }

    // queue the block for _processBlock to process later
    self._blockQueue.push(_block);

    // if we don't already have a timer, set one here to get things going
    if (!self._blockProcessor) {

      self._blockProcessor = setInterval(self._processBlocks.bind(self), 1000);

    }

  });

};


// under normal circumstances, the queue will only have 1-2 items in it, probably less
// we need this in case there is a deluge of blocks from a peer, asynchronously
HeaderService.prototype._processBlocks = function() {

  // if we have no blocks to process, exit
  var block = this._blockQueue.shift();

  if (!block) {
    return;
  }

  // if the block service is busy, then exit and wait for the next call
  // we can leave this interval handler enabled because the block service should set the
  // syncing flag while is it processing blocks
  if (this.blockServiceSyncing) {
    return;
  }

  this._broadcast(block);
};

HeaderService.prototype._persistHeader = function(block, callback) {

  var self = this;

  self._detectReorg(block, function(err, reorgStatus, historicalBlock) {

    if (err) {
      return callback(err);
    }

    // common case
    if (historicalBlock) {
      return callback();
    }

    // new block, not causing a reorg
    if (!reorgStatus && !historicalBlock) {

      return self._syncBlock(block, function(err) {

        if (err) {
          return callback(err);
        }

        if (!self.blockServiceSyncing && !self._blockProcessor) {
          self._blockProcessor = setInterval(self._processBlocks.bind(self), 1000);
        }

        callback();

      });
    }

    // new block causing a reorg
    self._handleReorg(block, self._formatHeader(block), function(err) {

      if (err) {
        return callback(err);
      }

    });
  });

};

HeaderService.prototype._formatHeader = function(block) {

  var header = block.toHeaders().toJSON();
  header.timestamp = header.ts;
  header.prevHash = header.prevBlock;
  return header;

};

HeaderService.prototype._syncBlock = function(block, callback) {

  var self = this;

  var header = self._formatHeader(block);

  log.debug('Header Service: new block: ' + block.rhash());

  self._saveHeaders(self._onHeader(header), function(err) {

    if (err) {
      return callback(err);
    }

    self._onHeadersSave();
    callback();
  });

};

HeaderService.prototype._broadcast = function(block) {
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('header/block', block);
  }
};

HeaderService.prototype._onHeader = function(header) {

  if (!header) {
    return;
  }

  header.height = this._lastHeader.height + 1;
  header.chainwork = this._getChainwork(header, this._lastHeader).toString(16, 64);

  if (!header.timestamp) {
    header.timestamp = header.time;
  }

  this._lastHeader = header;

  return [
    {
      type: 'put',
      key: this._encoding.encodeHeaderHashKey(header.hash),
      value: this._encoding.encodeHeaderValue(header)
    },
    {
      type: 'put',
      key: this._encoding.encodeHeaderHeightKey(header.height),
      value: this._encoding.encodeHeaderValue(header)
    }
  ];

};

HeaderService.prototype._onHeaders = function(headers) {

  var self = this;

  if (self._headerInterval) {
    clearInterval(self._headerInterval);
    self._headerInterval = null;
  }

  log.debug('Header Service: Received: ' + headers.length + ' header(s).');

  var dbOps = [];

  for(var i = 0; i < headers.length; i++) {

    var header = headers[i];

    header = header.toObject();

    var ops = self._onHeader(header);

    dbOps = dbOps.concat(ops);

    self._tip.height = header.height;
    self._tip.hash = header.hash;
  }

  self._saveHeaders(dbOps, function(err) {
    if (err) {
      log.error(err);
      return self.node.stop();
    }
    self._onHeadersSave();
  });

};

HeaderService.prototype._saveHeaders = function(dbOps, callback) {

  var tipOps = utils.encodeTip(this._tip, this.name);

  dbOps.push({
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  });

  this._db.batch(dbOps, callback);
};

HeaderService.prototype._onHeadersSave = function(err) {

  var self = this;

  if (err) {
    log.error(err);
    self.node.stop();
    return;
  }

  if (!self._syncComplete()) {

    self._sync();
    return;

  }

  self._startBlockSubscription();

  self._setBestHeader();

  self.emit('headers');

};

HeaderService.prototype._startBlockSubscription = function() {

  if (this._subscribedBlock) {
    return;
  }

  this._subscribedBlock = true;

  this._bus.on('p2p/block', this._queueBlock.bind(this));
  this._bus.subscribe('p2p/block');

};

HeaderService.prototype._syncComplete = function() {

  return this._tip.height >= this._bestHeight;

};

HeaderService.prototype._setBestHeader = function() {

  var bestHeader = this._lastHeader;
  this._tip.height = bestHeader.height;
  this._tip.hash = bestHeader.hash;

  log.debug('Header Service: ' + bestHeader.hash + ' is the best block hash.');
};

HeaderService.prototype._getHeader = function(height, hash, callback) {

  var self = this;

  /*jshint -W018 */
  if (!hash && !(height >= 0)) {
    /*jshint +W018 */
    return callback(new Error('invalid arguments'));
  }


  var key;
  if (hash) {
    key = self._encoding.encodeHeaderHashKey(hash);
  } else {
    key = self._encoding.encodeHeaderHeightKey(height);
  }

  self._db.get(key, function(err, data) {

    if (err) {
      return callback(err);
    }

    if (!data) {
      return callback();
    }

    callback(null, self._encoding.decodeHeaderValue(data));

  });

};

HeaderService.prototype._detectReorg = function(block, callback) {

  var self = this;

  var prevHash = bcoin.util.revHex(block.prevBlock);
  var nextBlock = prevHash === self._lastHeader.hash;

  // this is the last block the block service asked for
  if (prevHash === this.lastBlockQueried && this.blockServiceSyncing) {
    return callback(null, false, true);
  }

  // new block, not a historical block
  if (nextBlock) {
    return callback(null, false, false);
  }

  // could really be a reorg block
  var key = this._encoding.encodeHeaderHashKey(prevHash);

  this._db.get(key, function(err, val) {

    if (err) {
      return callback(err);
    }

    // is this block's prevHash already referenced in the database? If so, reorg
    if (val) {
      return callback(null, true, false);
    }

    callback(null, false, false);

  });

};

HeaderService.prototype._handleReorg = function(block, header, callback) {

  var self = this;

  self.getAllHeaders(function(err, headers) {

    if (err || !headers) {
      return callback(err || new Error('Missing headers'));
    }

    var hash = block.rhash();
    headers.set(hash, header); // appends to the end

    // this will ensure our own headers collection is correct
    self._onReorg(block, headers, function(err) {

      if (err) {
        return callback(err);
      }

      self.emit('reorg', hash, headers);
      return callback();
    });

  });

};

HeaderService.prototype._onReorg = function(block, headers, callback) {

  // this will be called when a new block (not historical) arrives and
  // has a common ancestor with a block that we already received.

  var self = this;
  // remove the current last header from the db
  var ops = [
    {
      type: 'del',
      key: self._encoding.encodeHeaderHashKey(self._lastHeader.hash)
    },
    {
      type: 'del',
      key: self._encoding.encodeHeaderHeightKey(self._lastHeader.height)
    }
  ];

  self._db.batch(ops, function(err) {

    if (err) {
      return callback(err);
    }

    // set the last header to the common ancestor
    self._lastHeader = headers.get(bcoin.util.revHex(block.prevBlock));
    assert(self._lastHeader, 'Expected our reorg block to have a header entry, but it did not.');

    // add the new block
    self._syncBlock(block, callback);

  });

};

HeaderService.prototype._setListeners = function() {

  this._p2p.once('bestHeight', this._onBestHeight.bind(this));

};

HeaderService.prototype._onBestHeight = function(height) {
  assert(height >= this._tip.height, 'Our peer does not seem to be fully synced: best height: ' +
    height + ' tip height: ' + this._tip.height);
  log.debug('Header Service: Best Height is: ' + height);
  this._bestHeight = height;
  this._startSync();
};

HeaderService.prototype._startSync = function() {

  this._numNeeded = this._bestHeight - this._tip.height;

  log.info('Header Service: Gathering: ' + this._numNeeded + ' ' + 'header(s) from the peer-to-peer network.');

  this._sync();

};

HeaderService.prototype._sync = function() {

  var self = this;

  var progress;
  var bestHeight = Math.max(self._bestHeight, self._lastHeader.height);

  if (bestHeight === 0) {
    progress = 0;
  } else {
    progress = (self._tip.height / self._bestHeight*100.00).toFixed(2);
  }

  log.info('Header Service: download progress: ' + self._tip.height + '/' +
    self._bestHeight + '  (' + progress + '%)');

  self._p2p.getHeaders({ startHash: self._tip.hash });

  // when connecting to a peer that isn't yet responding to getHeaders, we will start a interval timer
  // to retry until we can get headers, this may be a very long interval
  self._headerInterval = setInterval(function() {
    log.info('Header Service: retrying get headers since ' + self._tip.hash);
    self._p2p.getHeaders({ startHash: self._tip.hash });
  }, 2000);

};

// this gets the header that is +2 places from hash or returns 0 if there is no such
HeaderService.prototype.getNextHash = function(tip, callback) {

  var self = this;

  // if the tip being passed in is the second to last block, then return 0 because there isn't a block
  // after the last block
  if (tip.height + 1 === self._tip.height) {
    return callback(null, 0);
  }

  var start = self._encoding.encodeHeaderHeightKey(tip.height + 2);
  var end = self._encoding.encodeHeaderHeightKey(tip.height + 3);
  var result = 0;

  var criteria = {
    gte: start,
    lt: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;

  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    result = self._encoding.decodeHeaderValue(data.value).hash;
  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    callback(null, result);

  });

};

HeaderService.prototype.getLastHeader = function() {
  assert(this._lastHeader, 'Last header should be populated.');
  return this._lastHeader;
};

HeaderService.prototype._getLastHeader = function(callback) {

  var self = this;

  // redo all headers
  if (this._checkpoint === -1) {
    this._checkpoint = this._tip.height;
  }

  if (self._tip.height >= self._checkpoint) {
    self._tip.height -= self._checkpoint;
  }

  var removalOps = [];

  var start = self._encoding.encodeHeaderHeightKey(self._tip.height);
  var end = self._encoding.encodeHeaderHeightKey(0xffffffff);

  log.info('Getting last header synced at height: ' + self._tip.height);

  var criteria = {
    gte: start,
    lte: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;
  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    var header  = self._encoding.decodeHeaderValue(data.value);

    // any records with a height greater than our current tip height can be scheduled for removal
    // because they will be replaced shortly
    if (header.height > self._tip.height) {
      removalOps.push({
        type: 'del',
        key: data.key
      });
      return;
    } else if (header.height === self._tip.height) {
      self._lastHeader = header;
    }

  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    assert(self._lastHeader, 'The last synced header was not in the database.');
    self._tip.hash = self._lastHeader.hash;
    self._db.batch(removalOps, callback);

  });

};

HeaderService.prototype._getChainwork = function(header, prevHeader) {

  var prevChainwork = new BN(new Buffer(prevHeader.chainwork, 'hex'));

  return this._computeChainwork(header.bits, prevChainwork);
};

HeaderService.prototype._computeChainwork = function(bits, prev) {

  var target = consensus.fromCompact(bits);

  if (target.isNeg() || target.cmpn(0) === 0) {
    return new BN(0);
  }

  var proof =  HeaderService.MAX_CHAINWORK.div(target.iaddn(1));

  if (!prev) {
    return proof;
  }

  return proof.iadd(prev);

};

module.exports = HeaderService;

