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
  this._createConcurrencyCache();
  this._concurrencyCache.set(new Array(65).join('0'), { valueItem: 0 });
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db', 'block' ];

TimestampService.prototype.getAPIMethods = function() {
  return [
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};
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

TimestampService.prototype.concurrentBlockHandler = function(block, connectBlock, callback) {

  var self = this;

  var action = connectBlock ? 'put' : 'del';

  var filter = function(newBlockTime, prevBlockTime) {
    if (newBlockTime <= prevBlockTime) {
      return prevBlockTime + 1;
    }
    return newBlockTime;
  };

  var prevHash = utils.reverseBufferToString(block.header.prevHash);
  var hash = block.hash;
  var queue = self._retrieveCachedItems(hash, block.header.timestamp, prevHash, filter);

  var operations = [];

  if (queue.length === 0) {
    return callback(null, queue);
  }

  for(var i = 0; i < queue.length; i++) {

    var item = queue[i];
    operations = operations.concat([
      {
        type: action,
        key: self.encoding.encodeTimestampBlockKey(item.value),
        value: self.encoding.encodeTimestampBlockValue(item.key)
      },
      {
        type: action,
        key: self.encoding.encodeBlockTimestampKey(item.key),
        value: self.encoding.encodeBlockTimestampValue(item.value)
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
