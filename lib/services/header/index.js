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
  this._initialSync = true;
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

HeaderService.prototype._adjustTip = function() {

  if (this._checkpoint === -1 || this._tip.height < this._checkpoint) {

    this._tip.height = 0;
    this._tip.hash = this.GENESIS_HASH;

  } else {

    this._tip.height -= this._checkpoint;

  }

};

HeaderService.prototype._setGenesisBlock = function(callback) {

  assert(this._tip.hash === this.GENESIS_HASH, 'Expected tip hash to be genesis hash, but it was not.');

  var genesisHeader = {
    hash: this.GENESIS_HASH,
    height: 0,
    chainwork: HeaderService.STARTING_CHAINWORK,
    version: 1,
    prevHash: new Array(65).join('0'),
    timestamp: 1231006505,
    nonce: 2083236893,
    bits: 0x1d00ffff,
    merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
  };

  this._lastHeader = genesisHeader;

  var dbOps = [
    {
      type: 'put',
      key: this._encoding.encodeHeaderHeightKey(0),
      value: this._encoding.encodeHeaderValue(genesisHeader)
    },
    {
      type: 'put',
      key: this._encoding.encodeHeaderHashKey(this.GENESIS_HASH),
      value: this._encoding.encodeHeaderValue(genesisHeader)
    }
  ];

  this._db.batch(dbOps, callback);

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

      self._adjustTip();

      if (self._tip.height === 0) {
        return self._setGenesisBlock(next);
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

// block handler for blocks from the p2p network
HeaderService.prototype._queueBlock = function(block) {

  // this block was queried by the block service and, thus, we already have it
  if (block.rhash() === this.lastBlockQueried) {
    return;
  }

  // queue the block for _processBlock to process later
  // we won't start processing blocks until we have all of our headers
  // so if loading headers takes a really long time, we could have a long
  // list of blocks. Warning will be logged if this happens.
  this._blockQueue.push(block);

};


// we need this in case there is a deluge of blocks from a peer, asynchronously
HeaderService.prototype._processBlocks = function() {

  var self = this;
  var block = self._blockQueue.shift();

  if (self._blockQueue.length > 2) {
    // normally header sync is pretty quick, within a minute or two.
    // under normal circumstances, we won't queue many blocks
    log.warn('Header Service: Block queue has: ' + self._blockQueue.length + ' items.');
  }

  if (!block) {
    return;
  }

  assert(block.rhash() !== self._lastHeader.hash, 'Trying to save a header that has already been saved.');

  clearInterval(self._blockProcessor);
  self._blockProcessor = null;

  self._persistHeader(block, function(err) {

    if (err) {
      log.error(err);
      return self.node.stop();
    }

    if (!self.blockServiceSyncing) {
      self._broadcast(block);
    }

    self._blockProcessor = setInterval(self._processBlocks.bind(self), 1000);

  });

};

HeaderService.prototype._persistHeader = function(block, callback) {

  var self = this;

  self._detectReorg(block, function(err, commonHeader) {

    if (err) {
      return callback(err);
    }

    if (!commonHeader) {

      return self._syncBlock(block, callback);

    }

    log.warn('Header Service: Reorganization detected, current tip hash: ' +
      self._tip.hash + ' new block causing the reorg: ' + block.rhash() +
        ' common ancestor hash: ' + commonHeader.hash);

    self._handleReorg(block, commonHeader, function(err) {

      if(err) {
        return callback(err);
      }

      self._syncBlock(block, callback);

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

  self._logProgress();

  if (!self._syncComplete()) {

    self._sync();
    return;

  }

  if (self._initialSync) {
    // we'll turn the block processor on right after we've sync'ed headers
    self._blockProcessor = setInterval(self._processBlocks.bind(self), 1000);
  }

  self._startBlockSubscription();

  self._setBestHeader();

  self._initialSync = false;

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

  // common case
  if (nextBlock) {
    return callback(null, false);
  }

  this.getBlockHeader(prevHash, function(err, header) {

    if (err) {
      return callback(err);
    }

    // is this block's prevHash already referenced in the database? If so, reorg
    if (header) {
      return callback(null, header);
    }

    log.warn('Block: ' + block.rhash() + 'references: ' + prevHash + ' as its previous block, yet we have not stored this block in our data set, thus ignoring this block.');
    callback(null, false);

  });

};

HeaderService.prototype._handleReorg = function(block, commonHeader, callback) {

  var self = this;
  var reorgHeader = self._formatHeader(block);

  self.getAllHeaders(function(err, headers) {

    if (err || !headers) {
      return callback(err || new Error('Missing headers'));
    }

    var hash = block.rhash();
    headers.set(hash, reorgHeader); // appends to the end

    // this will ensure our own headers collection is correct
    self._onReorg(reorgHeader, headers, commonHeader, function(err) {

      if (err) {
        return callback(err);
      }

      // emit the fact that there is a reorg even though the block
      // service may not have reached this point in its sync.
      // Let the block service sort that our
      self.emit('reorg', hash, headers);
      return callback();
    });

  });

};

HeaderService.prototype._onReorg = function(reorgHeader, headers, commonHeader, callback) {
  // remove all headers with a height greater than commonHeader
  var ops = [];
  var startingHeight = this._tip.height;
  var hash = this._tip.hash;
  while(hash !== commonHeader.hash) {
    var header = headers.getIndex(startingHeight--);
    assert(header, 'Expected to have a header at this height, but did not. Reorg failed.');
    hash = header.prevHash;
    ops.push({
      type: 'del',
      key: this._encoding.encodeHeaderHashKey(header.hash)
    });
    ops.push({
      type: 'del',
      key: this._encoding.encodeHeaderHeightKey(header.height)
    });
  }
  // setting our tip to the common ancestor
  this._tip.hash = commonHeader.hash;
  this._tip.height = commonHeader.height;

  this._db.batch(ops, callback);
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

HeaderService.prototype._logProgress = function() {

  if (!this._initialSync) {
    return;
  }

  var progress;
  var bestHeight = Math.max(this._bestHeight, this._lastHeader.height);

  if (bestHeight === 0) {
    progress = 0;
  } else {
    progress = (this._tip.height/bestHeight*100.00).toFixed(2);
  }

  log.info('Header Service: download progress: ' + this._tip.height + '/' +
    bestHeight + '  (' + progress + '%)');

};

HeaderService.prototype._sync = function() {

  var self = this;

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
  var numResultsNeeded = 2;

  // if the tip being passed in is the second to last block, then return 0 because there isn't a block
  if (tip.height + 1 === self._tip.height) {
    numResultsNeeded = 1;
  }

  var start = self._encoding.encodeHeaderHeightKey(tip.height + 1);
  var end = self._encoding.encodeHeaderHeightKey(tip.height + 3);
  var results = [];

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
    results.push(self._encoding.decodeHeaderValue(data.value).hash);
  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    assert(results.length === numResultsNeeded, 'GetNextHash returned incorrect number of results.');

    if (!results[1]) {
      results[1] = 0;
    }

    callback(null, results[0], results[1]);

  });

};

HeaderService.prototype.getLastHeader = function() {
  assert(this._lastHeader, 'Last header should be populated.');
  return this._lastHeader;
};

HeaderService.prototype._getLastHeader = function(callback) {

  var self = this;

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

