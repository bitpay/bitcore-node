'use strict';

var Encoding = require('./encoding');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var LRU = require('lru-cache');
var utils = require('../../../lib/utils');

function TimestampService(options) {
  BaseService.call(this, options);
  this.currentBlock = null;
  this.currentTimestamp = null;
  this._cache = LRU(50);
  var genesis = self.node.services.block.genesis;
  this._cache.set(genesis.hash, genesis.__height);
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db' ];

TimestampService.prototype.start = function(callback) {
  var self = this;

  this.db = this.node.services.db;

  this.node.services.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }

    self.prefix = prefix;
    self.encoding = new Encoding(self.prefix);
    callback();
  });

  self.counter = 0;
};

TimestampService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TimestampService.prototype._processBlockHandlerQueue = function(block) {

  var self = this;

  var blockTime = block.header.timestamp;

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var prev = self._cache.get(prevHash);

  if (prev && !prev.prevHash) {

    if (blockTime <= prev.time) {
      blockTime++;
    }

    self._cache.del(prevHash);
    self._cache.set(block.hash, { time: blockTime });
    return [{ hash: block.hash, time: blockTime }];
  }

  self._cache.set(block.hash, { time: blockTime, prevHash: prevHash });

  var additionalBlocks = [];
  var dependentHash = block.hash;

  self._cache.rforEach(function(value, key) {
    if (dependentHash === value.prevHash) {
      additionalBlocks.push({ hash: key, time: value.time });
      dependentHash = value.prevHash;
      self._cache.del(key);
    }
  });

  return additionalBlocks;

};

TimestampService.prototype.blockHandler = function(block, connectBlock, callback) {

  var self = this;

  var action = connectBlock ? 'put' : 'del';

  var queue = self._processBlockHandlerQueue(block);

  var operations = [];

  if (!queue.length < 1) {
    return callback(null, []);
  }

  operations = operations.concat([
    {
      type: action,
      key: self.encoding.encodeTimestampBlockKey(timestamp),
      value: self.encoding.encodeTimestampBlockValue(block.header.hash)
    },
    {
      type: action,
      key: self.encoding.encodeBlockTimestampKey(block.header.hash),
      value: self.encoding.encodeBlockTimestampValue(timestamp)
    }
  ]);

  callback(null, operations);
};

TimestampService.prototype.getBlockHeights = function(timestamps, callback) {
  var self = this;
  timestamps.sort();
  timestamps = timestamps.map(function(timestamp) {
    return timestamp >= MAINNET_BITCOIN_GENESIS_TIME ? timestamp : MAINNET_BITCOIN_GENESIS_TIME;
  });
  var start = self.encoding.encodeTimestampBlockKey(timestamps[0]);
  var end = self.encoding.encodeTimestampBlockKey(timestamps[1]);
  var stream = self.db.createReadStream({
    gte: start,
    lte: end
  });

  var hashes = [];
  var hashTuple = [];
  var streamErr = null;

  stream.on('data', function(data) {
    hashes.push(self.encoding.decodeTimestampBlockValue(data.value));
  });

  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('end', function() {
    if (!streamErr && hashes.length > 1) {
      hashTuple = [ hashes[0], hashes[hashes.length - 1] ];
    }
    callback(streamErr, hashTuple);
  });

};

module.exports = TimestampService;
