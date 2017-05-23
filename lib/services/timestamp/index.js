'use strict';

var Encoding = require('./encoding');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var LRU = require('lru-cache');
var utils = require('../../../lib/utils');
var bitcore = require('bitcore-lib');

function TimestampService(options) {
  BaseService.call(this, options);
  this.currentBlock = null;
  this.currentTimestamp = null;
  this._cache = LRU(50);
  this._cache.set(new Array(65).join('0'), { time: 0 });
  this._setHandlers();
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db', 'block' ];

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

};

TimestampService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TimestampService.prototype._setHandlers = function() {
  var self = this;
};

TimestampService.prototype._processBlockHandlerQueue = function(block) {

  var self = this;

  var blockTime = block.header.timestamp;

  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var prev = self._cache.get(prevHash);

  if (prev && !prev.prevHash) {

    if (blockTime <= prev.time) {
      blockTime = prev.time + 1;
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

  if (queue.length === 0) {
    return callback(null, queue);
  }

  for(var i = 0; i < queue.length; i++) {

    var item = queue[i];
    operations = operations.concat([
      {
        type: action,
        key: self.encoding.encodeTimestampBlockKey(item.time),
        value: self.encoding.encodeTimestampBlockValue(item.hash)
      },
      {
        type: action,
        key: self.encoding.encodeBlockTimestampKey(item.hash),
        value: self.encoding.encodeBlockTimestampValue(item.time)
      }
    ]);
  }

  callback(null, operations);

};

TimestampService.prototype.getTimestamp = function(hash, callback) {
  this._getValue(hash, callback);
};

TimestampService.prototype.getHash = function(timestamp, callback) {
  this._getValue(timestamp, callback);
};

TimestampService.prototype._getValue = function(key, callback) {

  var self = this;
  var keyBuf, fn;

  if (key.length === 64){
    keyBuf = self.encoding.encodeBlockTimestampKey(key);
    fn = self.encoding.decodeBlockTimestampValue;
  } else {
    keyBuf = self.encoding.encodeTimestampBlockKey(key);
    fn = self.encoding.decodeTimestampBlockValue;
  }

  self.db.get(keyBuf, function(err, value) {

    if (err) {
      return callback(err);
    }

    callback(null, fn(value));

  });
};
module.exports = TimestampService;
