'use strict';

var BaseService = require('../../service');
var Encoding = require('./encoding');
var assert = require('assert');
var _ = require('lodash');
var index = require('../../index');
var log = index.log;
var LRU = require('lru-cache');

var inherits = require('util').inherits;
var utils = require('../../../lib/utils');

function TimestampService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._tip = null;
  this._lastBlockTimestamp = 0;
  this._cache = new LRU(10);
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db', 'block' ];

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
  self._setListeners();

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self._prefix = prefix;
    self._encoding = new Encoding(self._prefix);

    self._db.getServiceTip(self.name, function(err, tip) {

      if (err) {
        return callback(err);
      }

      self._tip = tip;
      self._startSubscriptions();
      callback();

    });
  });

};

TimestampService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('block/reorg', this._onReorg.bind(this));
  this._bus.subscribe('block/reorg');
};

TimestampService.prototype._sync = function() {

  if (--this._p2pBlockCallsNeeded > 0) {

    log.info('Blocks download progress: ' + this._numCompleted + '/' +
      this._numNeeded + '  (' + (this._numCompleted/this._numNeeded*100).toFixed(2) + '%)');
    this._p2p.getBlocks({ startHash: this._latestBlockHash });
    return;

  }

};

TimestampService.prototype._setListeners = function() {

  var self = this;
  self.on('reorg', self._onReorg.bind(self));

};

TimestampService.prototype._setTip = function(tip) {
  log.debug('Timestamp Service: Setting tip to height: ' + tip.height);
  log.debug('Timestamp Service: Setting tip to hash: ' + tip.hash);
  this._tip = tip;
  this._db.setServiceTip('block', this._tip);
};

TimestampService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TimestampService.prototype.onBlock = function(block, callback) {

  var operations = [];

  var ts = block.ts;
  var hash = block.rhash();

  if (ts <= this._lastBlockTimestamp) {
    ts = this._lastBlockTimestamp + 1;
  }

  this._lastBlockTimestamp = ts;

  this._tip.hash = hash;
  this._tip.height++;
  this._cache.set(hash, ts);

  var tipInfo = utils.encodeTip(this._tip, this.name);

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
    },
    {
      type: 'put',
      key: tipInfo.key,
      value: tipInfo.value
    }

  ]);

  setImmediate(function() {
    callback(null, operations);
  });
};

TimestampService.prototype._onReorg = function(oldBlockList, newBlockList, commonAncestor) {

  // if the common ancestor block height is greater than our own, then nothing to do for the reorg
  if (this._tip.height <= commonAncestor.header.height) {
    return;
  }

  // set the tip to the common ancestor in case something goes wrong with the reorg
  var tipOps = utils.encodeTip({ hash: commonAncestor.hash, height: commonAncestor.header.height }, this.name);

  var removalOps = [{
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  }];


  // remove all the old blocks that we reorg from
  oldBlockList.forEach(function(block) {
    removalOps.concat([
      {
        type: 'del',
        key: this.encoding.encodeTimestampBlockKey(block.ts),
      },
      {
        type: 'del',
        key: this.encoding.encodeBlockTimestampKey(block.rhash()),
      }
    ]);
  });

  this._db.batch(removalOps);

  // set the last time stamp to the common ancestor
  this._lastBlockTimestamp = commonAncestor.ts;

  //call onBlock for each of the new blocks
  newBlockList.forEach(this._onBlock.bind(this));

};


TimestampService.prototype.getTimestampSync = function(hash) {
   return this._cache.get(hash);
};

TimestampService.prototype.getTimestamp = function(hash, callback) {
  this._db.get(this._encoding.encodeBlockTimestampKey(hash), callback);
};

TimestampService.prototype.getHash = function(timestamp, callback) {
  this._db.get(this._encoding.encodeTimestampBlockKey(timestamp), callback);
};


module.exports = TimestampService;
