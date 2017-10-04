'use strict';

var BaseService = require('../../service');
var Encoding = require('./encoding');
var assert = require('assert');
var _ = require('lodash');
var LRU = require('lru-cache');

var inherits = require('util').inherits;

function TimestampService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._lastBlockTimestamp = 0;
  this._cache = new LRU(10);
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db' ];

TimestampService.prototype.getAPIMethods = function() {
  return [
    ['getBlockHashesByTimestamp', this, this.getBlockHashesByTimestamp, 2]
  ];
};

TimestampService.prototype.getBlockHashesByTimestamp = function(high, low, callback) {

  assert(_.isNumber(low) && _.isNumber(high) && low < high,
    'start time and end time must be integers representing the number of seconds since epoch.');

  var self = this;
  var result = [];

  var start = self._encoding.encodeTimestampBlockKey(low);
  var end = self._encoding.encodeTimestampBlockKey(high);

  var criteria = {
    gte: start,
    lte: end
  };

  var tsStream = self._db.createReadStream(criteria);

  tsStream.on('data', function(data) {
    var value = self._encoding.decodeTimestampBlockValue(data.value);
    result.push(value);
  });

  var streamErr;
  tsStream.on('error', function(err) {
    streamErr = err;
  });

  tsStream.on('end', function() {

    if(streamErr) {
      return callback(streamErr);
    }

    if (!result) {
      return callback();
    }

    return callback(null, result);

  });

};

TimestampService.prototype.start = function(callback) {
  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self._prefix = prefix;
    self._encoding = new Encoding(self._prefix);

    callback();

  });

};

TimestampService.prototype.onBlock = function(block, callback) {

  var operations = [];

  var ts = block.ts;
  var hash = block.rhash();

  if (ts <= this._lastBlockTimestamp) {
    ts = this._lastBlockTimestamp + 1;
  }

  this._lastBlockTimestamp = ts;

  this._cache.set(hash, ts);

  operations = operations.concat([
    {
      type: 'put',
      key: this._encoding.encodeTimestampBlockKey(ts),
      value: this._encoding.encodeTimestampBlockValue(hash)
    },
    {
      type: 'put',
      key: this._encoding.encodeBlockTimestampKey(hash),
      value: this._encoding.encodeBlockTimestampValue(ts)
    }
  ]);

  callback(null, operations);
};

TimestampService.prototype.onReorg = function(args, callback) {

  var self = this;
  var commonAncestorHash = args[0];
  var oldBlockList = args[1];

  var removalOps = [];

  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.concat([
      {
        type: 'del',
        key: self._encoding.encodeTimestampBlockKey(block.__ts),
      },
      {
        type: 'del',
        key: self._encoding.encodeBlockTimestampKey(block.rhash()),
      }
    ]);
  });

  // look up the adjusted timestamp from our own database and set the lastTimestamp to it
  self.getTimestamp(commonAncestorHash, function(err, timestamp) {

    if (err) {
      return callback(err);
    }
    self._lastBlockTimestamp = timestamp;
    callback(null, removalOps);
  });

};


TimestampService.prototype.getTimestampSync = function(hash) {
   return this._cache.get(hash);
};

TimestampService.prototype.getTimestamp = function(hash, callback) {
  var self = this;

  self._db.get(self._encoding.encodeBlockTimestampKey(hash), function(err, data) {
    if (err) {
      return callback(err);
    }
    if (!data) {
      return callback();
    }
    callback(null, self._encoding.decodeBlockTimestampValue(data));
  });

};

TimestampService.prototype.getHash = function(timestamp, callback) {
  var self = this;
  self._db.get(self._encoding.encodeTimestampBlockKey(timestamp), function(err, data) {
    if (err) {
      return callback(err);
    }
    callback(null, self._encoding.decodeTimestampBlockValue(data));
  });
};

module.exports = TimestampService;
