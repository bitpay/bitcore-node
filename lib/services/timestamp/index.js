'use strict';

var Encoding = require('./encoding');

var inherits = require('util').inherits;
var LRU = require('lru-cache');
var utils = require('../../../lib/utils');

function TimestampService(options) {
  BaseService.call(this, options);
  this._db = this.node.services.db;
  this._tip = null;
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db', 'block' ];

TimestampService.prototype.getAPIMethods = function() {
  return [
    ['getBlockHashesByTimestamp', this, this.getBlockHashesByTimestamp, 2],
    ['syncPercentage', this, this.syncPercentage, 0]
  ];
};

TimestampService.prototype.syncPercentage = function(callback) {
};

TimestampService.prototype.getBlockHashesByTimestamp = function(callback) {
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

  this._bus.on('block/block', this._onBlock.bind(this));
  this._bus.subscribe('block/block');
};

BlockService.prototype._sync = function() {

  if (--this._p2pBlockCallsNeeded > 0) {

    log.info('Blocks download progress: ' + this._numCompleted + '/' +
      this._numNeeded + '  (' + (this._numCompleted/this._numNeeded*100).toFixed(2) + '%)');
    this._p2p.getBlocks({ startHash: this._latestBlockHash });
    return;

  }

};
TimestampService.prototype._setListeners = function() {

  var self = this;

  self._db.on('error', self._onDbError.bind(self));
  self.on('reorg', self._handleReorg.bind(self));

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

TimestampService.prototype._onBlock = function(block) {


  var prevHash = utils.reverseBufferToString(block.header.prevHash);

  var operations = [];

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

TimestampService.prototype._onReorg = function(commonAncestor, newBlockList) {
};

TimestampService.prototype.getBlockHashesByTimestamp = function(high, low, options, callback) {

  var self = this;
  if (_.isFunction(options)) {
    callback = options;
    options = {};
  }

};

module.exports = TimestampService;
