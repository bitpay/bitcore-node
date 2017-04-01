'use strict';
var Encoding = require('./encoding');
var BaseService = require('../../service');
var inherits = require('util').inherits;

function TimestampService(options) {
  BaseService.call(this, options);
  this.currentBlock = null;
  this.currentTimestamp = null;
}

inherits(TimestampService, BaseService);

TimestampService.dependencies = [ 'db' ];

TimestampService.prototype.start = function(callback) {
  var self = this;

  this.store = this.node.services.db.store;

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

TimestampService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  var action = 'put';
  if (!connectBlock) {
    action = 'del';
  }

  var operations = [];

  function getLastTimestamp(next) {
    if(!block.header.prevHash) {
      // Genesis block
      return next(null, 0);
    } else if(block.__height === 1) {
      // TODO fix bug where genesis block doesn't get indexed
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

    self.currentBlock = block.hash;
    self.currentTimestamp = timestamp;

    operations = operations.concat(
      [
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
      ]
    );

    callback(null, operations);
  });
};

TimestampService.prototype.getTimestamp = function(hash, callback) {
  var self = this;

  if (hash === self.currentBlock) {
    return setImmediate(function() {
       callback(null, self.currentTimestamp);
    });
  }

  var key = self.encoding.encodeBlockTimestampKey(hash);
  self.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    return callback(null, self.encoding.decodeBlockTimestampValue(buffer));
  });
};

TimestampService.prototype.getBlockHeights = function(timestamps, callback) {
  var self = this;
  timestamps.sort();
  var stream = self.store.createReadStream({
    gte: self.encoding.encodeTimestampBlockKey(timestamps[0]),
    lte: self.encoding.encodeTimestampBlockKey(timestamps[1])
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
