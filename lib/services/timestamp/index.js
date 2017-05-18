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
  this._blockHandlerQueue = LRU(50);
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
  //do we have a record in the queue that is waiting on me to consume it?
  var prevHash = utils.getPrevHashString(block);
  if (prevHash.length !== 64) {
    return;
  }

  var timestamp = self._blockHandlerQueue.get(prevHash);

  if (timestamp) {
    if (block.header.timestamp <= timestamp) {
      timestamp = block.header.timestamp + 1;
    }
    self.counter++;
    timestamp = block.header.timestamp;
    self._blockHandlerQueue.del(prevHash);
  } else {
    timestamp = block.header.timestamp;
  }

  self._blockHandlerQueue.set(block.hash, timestamp);
  return timestamp;
};

TimestampService.prototype.blockHandler = function(block, connectBlock, callback) {

  var self = this;

  var action = connectBlock ? 'put' : 'del';

  var timestamp = self._processBlockHandlerQueue(block);

  if (!timestamp) {
    return callback(null, []);
  }

  var operations = [];

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
