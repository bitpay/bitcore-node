'use strict';
var BaseService = require('../../service');
var inherits = require('util').inherits;

function TimestampService(options) {
  BaseService.call(this, options);

}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [
  'db'
];

TimestampService.prototype.start = function(callback) {
  var self = this;

  this.store = this.node.services.db.store;

  this.node.services.db.getPrefix(this.name, function(err, prefix) {
    if(err) {
      return callback(err);
    }

    self.prefix = prefix;

    callback();
  });
};

TimestampService.prototype.stop = function(callback) {
  setImmediate(callback);
};

TimestampService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  var action = 'put';
  if (!connectBlock) {
    action = 'del';
  }

  var operations = [];

  function getLastTimestamp(next) {
    var timestamp;

    if(!block.header.prevHash) {
      // Genesis block
      return next(null, 0);
    }

    self.getTimestamp(block.header.prevHash.reverse().toString('hex'), next);
  }

  getLastTimestamp(function(err, lastTimestamp) {
    if(err) {
      return callback(err);
    }

    var timestamp = block.header.timestamp;
    if(timestamp <= lastTimestamp) {
      timestamp = lastTimestamp + 1;
    }

    operations.push({
      type: action,
      key: self._encodeTimestampBlockKey(timestamp),
      value: self._encodeTimestampBlockValue(block.header.hash)
    });

    callback(null, operations);
  });
};

Timestamp.prototype.getTimestamp = function(hash, callback) {
  var key = this._encodeBlockTimestampKey(hash);
  this.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    return callback(null, this._decodeBlockTimestampValue(buffer));
  });
};

TimestampService.prototype._encodeBlockTimestampKey = function(hash) {
  return Buffer.concat([self.prefix, new Buffer(hash, 'hex')]);
};

TimestampService.prototype._decodeBlockTimestampKey = function(buffer) {
  return buffer.slice(1).toString('hex');
};

TimestampService.prototype._encodeBlockTimestampValue = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return timestampBuffer;
};

TimestampService.prototype._decodeBlockTimestampValue = function(buffer) {
  return buffer.readDoubleBE(0);
};

TimestampService.prototype._encodeTimestampBlockKey = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return Buffer.concat([self.prefix, timestampBuffer]);
};

TimestampService.prototype._decodeTimestampBlockKey = function(buffer) {
  return buffer.readDoubleBE(1);
};

TimestampService.prototype._encodeTimestampBlockValue = function(hash) {
  return new Buffer(hash, 'hex');
};

TimestampService.prototype._decodeTimestampBlockValue = function(buffer) {
  return buffer.toString('hex');
};

module.exports = TimestampService;