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

var HeaderService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._checkpoint = this.node.checkpoint || 1000; // the # of header to look back on boot
  this._headers = new utils.SimpleMap();

  this.subscriptions = {};
  this.subscriptions.block = [];
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

HeaderService.prototype.getBlockHeader = function(arg) {

  if (utils.isHeight(arg)) {
    var header = this._headers.getIndex(arg);
    return header ? header : null;
  }

  return this._headers.get(arg);
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
      self._originalTip = Object.assign(self._tip, {});
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
    self._startSubscriptions();
    callback();

  });

};

HeaderService.prototype.stop = function(callback) {
  setImmediate(callback);
};

HeaderService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost-header'});
  }

  this._bus.on('p2p/headers', this._onHeaders.bind(this));
  this._bus.on('p2p/block', this._onBlock.bind(this));
  this._bus.subscribe('p2p/headers');
  this._bus.subscribe('p2p/block');

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

  log.debug('Header Service: new block: ' + hash);

  // this is case where a block was requested by referencing a
  // hash from our own headers set.
  if (this._headers.get(hash)) {

    for (var i = 0; i < this.subscriptions.block.length; i++) {
      this.subscriptions.block[i].emit('header/block', block);
    }

    return;

  }

  var header = block.toHeaders().toJSON();
  header.timestamp = header.ts;
  header.prevHash = header.prevBlock;
  this._onHeaders([header], 1);

};

HeaderService.prototype._onHeaders = function(headers, convert) {

  var self = this;
  if (!headers || headers.length < 1) {
    return;
  }

  log.debug('Header Service: Received: ' + headers.length + ' header(s).');

  var newHeaders = headers;
  if (!convert) {
    newHeaders = headers.map(function(header) {
      header = header.toObject();
      return header;
    });
  }

  var runningHeight = self._tip.height;
  var prevHeader = self._headers.getLastIndex();

  var dbOps = [];
  for(var i = 0; i < headers.length; i++) {
    var header = headers[i];
    header.height = ++runningHeight;
    header.chainwork = self._getChainwork(header, prevHeader).toString(16, 32);
    dbOps.push({
      type: 'put',
      key: self._encoding.encodeHeaderKey(header.height, header.hash),
      value: self._encoding.encodeHeaderValue(header)
    });
    prevHeader = header;
    self._headers.set(header.hash, header);
  }

  self._startingHash = self._tip.hash = newHeaders[newHeaders.length - 1].hash;
  self._tip.height = self._tip.height + newHeaders.length;

  var tipOps = utils.encodeTip(self._tip, self.name);
  dbOps.push({
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  });

  self._db._store.batch(dbOps, function() {
    self._sync();
  });

};

HeaderService.prototype._setListeners = function() {

  this._p2p.once('bestHeight', this._onBestHeight.bind(this));

};

HeaderService.prototype._onBestHeight = function(height) {
  assert(height >= this._tip.height, 'Our peer does not seem to be fully synced.');
  log.debug('Header Service: Best Height is: ' + height);
  this._bestHeight = height;
  this._startSync();
};

HeaderService.prototype._startSync = function() {

  this._numNeeded = Math.max(this._bestHeight - this._tip.height, this._checkpoint);

  if (this._tip.height > this._checkpoint) {
    this._tip.height -= this._checkpoint;
    this._tip.hash = this._headers.getIndex(this._tip.height).hash;
  }

  log.info('Header Service: Gathering: ' + this._numNeeded + ' ' + 'header(s) from the peer-to-peer network.');

  this._sync();

};

HeaderService.prototype._sync = function() {


  if (this._tip.height < this._bestHeight) {

    log.debug('Header Service: download progress: ' + this._tip.height + '/' +
      this._numNeeded + '  (' + (this._tip.height / this._numNeeded*100).toFixed(2) + '%)');

    this._p2p.getHeaders({ startHash: this._tip.hash });

    return;
  }

  log.debug('Header Service: download complete.');

  // have we reorg'ed since we've been shutdown?
  var headerHash = this._headers.getIndex(this._originalTip.height).hash;

  if (this._originalTip.hash !== headerHash) {

    this.emit('reorg', headerHash, this._headers);
    return;

  }

  this.emit('headers', this._headers);

};

HeaderService.prototype.getAllHeaders = function() {
  return this._headers;
};

HeaderService.prototype._getPersistedHeaders = function(callback) {

  var self = this;
  var start = self._encoding.encodeHeaderKey(0);
  var end = self._encoding.encodeHeaderKey(0xffffffff);
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
    self._headers.set(self._encoding.decodeHeaderKey(data.key).hash, self._encoding.decodeHeaderValue(data.value));
  });

  stream.on('end', function() {
    if (streamErr) {
      return streamErr;
    }
    callback();
  });

};

HeaderService.prototype._getChainwork = function(header, prevHeader) {

  var lastChainwork = prevHeader ? prevHeader.chainwork : HeaderService.STARTING_CHAINWORK;
  var prevChainwork = new BN(new Buffer(lastChainwork, 'hex'));

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

