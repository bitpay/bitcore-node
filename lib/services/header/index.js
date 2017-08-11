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
  this._headers = new utils.SimpleMap();

  this.subscriptions = {};
  this.subscriptions.block = [];
  this._checkpoint = options.checkpoint || 2000;
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._initiallySynced = false;
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

HeaderService.prototype.getBlockHeader = function(arg, callback) {

  if (utils.isHeight(arg)) {
    return callback(null, this._headers.getIndex(arg));
  }

  return callback(null, this._headers.get(arg));

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
      log.debug('Header Service: original tip height is: ' + self._tip.height);
      log.debug('Header Service: original tip hash is: ' + self._tip.hash);

      self._originalTip = { height: self._tip.height, hash: self._tip.hash };

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

        self._headers.set(self.GENESIS_HASH, genesisHeader, 0);

        self._db._store.put(self._encoding.encodeHeaderKey(0, self.GENESIS_HASH),
          self._encoding.encodeHeaderValue(genesisHeader), next);
        return;

      }
      next();
    },
    function(next) {
      self._getPersistedHeaders(next);
    }
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
  setImmediate(callback);
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

HeaderService.prototype._onBlock = function(block) {

  var hash = block.rhash();
  var header = this._headers.get(hash);

  if (!header) {
    log.debug('Header Service: new block: ' + hash);

    if (this._detectReorg()) {
      this._handleReorg();
      return;
    }

    header = block.toHeaders().toJSON();
    header.timestamp = header.ts;
    header.prevHash = header.prevBlock;
    this._saveHeaders([this._onHeader(header)]);
  }

  for (var i = 0; i < this.subscriptions.block.length; i++) {
    var prevHeader = this._headers.get(header.prevHash);
    assert(prevHeader, 'We must have a previous header in order to calculate this block\'s data.');
    block.height = prevHeader.height + 1;
    this.subscriptions.block[i].emit('header/block', block, header);
  }

};

HeaderService.prototype._onHeader = function(header) {

  var prevHeader = this._headers.get(header.prevHash);
  assert(prevHeader, 'We must have a previous header in order to calculate this header\'s data, current header is: ' + header.hash);

  header.height = prevHeader.height + 1;
  header.chainwork = this._getChainwork(header, prevHeader).toString(16, 64);

  var newHdr = {
    hash: header.hash,
    prevHash: header.prevHash,
    height: header.height,
    chainwork: header.chainwork
  };

  this._headers.set(header.hash, newHdr, header.height);

  return {
    type: 'put',
    key: this._encoding.encodeHeaderKey(header.height, header.hash),
    value: this._encoding.encodeHeaderValue(header)
  };

};

HeaderService.prototype._onHeaders = function(headers) {

  log.debug('Header Service: Received: ' + headers.length + ' header(s).');

  var dbOps = [];

  for(var i = 0; i < headers.length; i++) {

    var header = headers[i];

    header = header.toObject();

    dbOps.push(this._onHeader(header));

    this._tip.height = header.height;
    this._tip.hash = header.hash;
  }

  this._saveHeaders(dbOps);

};

HeaderService.prototype._saveHeaders = function(dbOps) {

  var tipOps = utils.encodeTip(this._tip, this.name);

  dbOps.push({
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  });

  this._db.batch(dbOps, this._onHeadersSave.bind(this));
};

HeaderService.prototype._onHeadersSave = function(err) {

    if(err) {
      log.error(err);
      this.node.stop();
      return;
    }

    if (!this._syncComplete()) {

      this._sync();
      return;

    }

    assert(!this._headers.hasNullItems(), 'Header list is not complete yet peer has sent all available headers.');

    this._startBlockSubscription();

    this._setBestHeader();

    if (this._detectReorg()) {
      this._handleReorg();
      return;
    }

    this._populateNextHashes();

    log.debug('Header Service: emitting headers to block service.');
    this._populateNextHashes();

    this.emit('headers', this._headers);

};

HeaderService.prototype._startBlockSubscription = function() {

  if (this._subscribedBlock) {
    return;
  }

  this._subscribedBlock = true;

  this._bus.on('p2p/block', this._onBlock.bind(this));
  this._bus.subscribe('p2p/block');

};

HeaderService.prototype._syncComplete = function() {

  return this._tip.height >= this._bestHeight;

};


HeaderService.prototype._setBestHeader = function() {

    var bestHeader = this._headers.getLastIndex();
    this._tip.height = bestHeader.height;
    this._tip.hash = bestHeader.hash;

    log.debug('Header Service: ' + bestHeader.hash + ' is the best block hash.');
};

HeaderService.prototype._populateNextHashes = function() {

  var count = 0;

  while (count < this._headers.length) {
    var hdr = this._headers.getIndex(count);
    var nextHdr = this._headers.getIndex(++count);
    if (nextHdr) {
      hdr.nextHash = nextHdr.hash;
    }
  }

};

HeaderService.prototype._detectReorg = function(block) {

  // this is a new block coming after we are sync'ed.
  // for this not to be a reorg, this block's prev hash should be our tip
  // in rare cases, we don't even have this block's parent in our collection
  if (block) {
    var prevHash = bcoin.util.revHex(block.prevBlock);
    if (prevHash === this._tip.hash) {
      return false;
    }

    var parentHeader = this._headers.get(prevHash);
    if (!parentHeader) {
      log.warn('Block with hash: ' + block.rhash() +
        ' is not in our header set. This could be a block delievered out of order or this block\'s parent: ' +
        prevHash + ' has been orphaned before we synced our headers the last time.');
      return false;
    }

    return true;
  }
  // is our original tip's height and hash the same after we rewound by the checkpoint amount of blocks
  // and re-imported? If so, then we've reorg'ed since we've been shut down.
  var headerHash = this._headers.getIndex(this._originalTip.height).hash;

  assert(headerHash, 'Expected a header to exist at height ' + this._originalTip.height);

  if (this._originalTip.hash !== headerHash) {
    return true;
  }

  return false;

};

HeaderService.prototype._handleReorg = function() {
  this.emit('reorg', this._headers.getIndex(this._originalTip.height).hash, this._headers);
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

  this._numNeeded = Math.max(this._bestHeight - this._tip.height, this._checkpoint);

  log.info('Header Service: Gathering: ' + this._numNeeded + ' ' + 'header(s) from the peer-to-peer network.');

  this._sync();

};

HeaderService.prototype._sync = function() {

  log.debug('Header Service: download progress: ' + this._tip.height + '/' +
    this._bestHeight + '  (' + (this._tip.height / this._bestHeight*100.00).toFixed(2) + '%)');

  this._p2p.getHeaders({ startHash: this._tip.hash });

};

HeaderService.prototype.getAllHeaders = function() {
  return this._headers;
};

HeaderService.prototype._getPersistedHeaders = function(callback) {

  var self = this;

  var startingHeight = self._tip.height;

  if (self._tip.height > self._checkpoint) {
    self._tip.height -= self._checkpoint;
  }

  var removalOps = [];

  var start = self._encoding.encodeHeaderKey(0);
  var end = self._encoding.encodeHeaderKey(startingHeight + 1);

  log.info('Getting persisted headers from genesis block to block ' + self._tip.height);

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
    }

    var newHdr = {
      hash: header.hash,
      prevHash: header.prevHash,
      height: header.height,
      chainwork: header.chainwork
    };

    self._headers.set(self._encoding.decodeHeaderKey(data.key).hash, newHdr, header.height);

  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    var tipHeader = self._headers.getIndex(self._tip.height);
    self._tip.hash = tipHeader.hash;
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

