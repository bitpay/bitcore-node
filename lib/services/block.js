'use strict';
var BaseService = require('../service');
var inherits = require('util').inherits;

function BlockService(options) {
  BaseService.call(this, options);
  this.currentBlock = null;
  this.currentTimestamp = null;
}

inherits(BlockService, BaseService);

BlockService.dependencies = [
  'db',
  'transaction'
];

BlockService.prototype.start = function(callback) {
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

BlockService.prototype.stop = function(callback) {
  setImmediate(callback);
};

BlockService.prototype.blockHandler = function(block, connectBlock, callback) {
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

    // TODO combine with block header

    operations = operations.concat(
      [
        {
          type: action,
          key: self._encodeTimestampBlockKey(timestamp),
          value: self._encodeTimestampBlockValue(block.header.hash)
        },
        {
          type: action,
          key: self._encodeBlockTimestampKey(block.header.hash),
          value: self._encodeBlockTimestampValue(timestamp)
        }
      ]
    );

    callback(null, operations);
  });
};

BlockService.prototype.getBlock = function(hash, callback) {
  // get block header
  // get individual transactions
};

BlockService.prototype.getBlockByHeight = function(height, callback) {

};

BlockService.prototype.getTimestamp = function(hash, callback) {
  var self = this;

  if (hash === self.currentBlock) {
    return setImmediate(function() {
       callback(null, self.currentTimestamp);
    });
  }

  var key = self._encodeBlockTimestampKey(hash);
  self.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    return callback(null, self._decodeBlockTimestampValue(buffer));
  });
};

BlockService.prototype._encodeBlockTimestampKey = function(hash) {
  return Buffer.concat([this.prefix, new Buffer(hash, 'hex')]);
};

BlockService.prototype._decodeBlockTimestampKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

BlockService.prototype._encodeBlockTimestampValue = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return timestampBuffer;
};

BlockService.prototype._decodeBlockTimestampValue = function(buffer) {
  return buffer.readDoubleBE(0);
};

BlockService.prototype._encodeTimestampBlockKey = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return Buffer.concat([this.prefix, timestampBuffer]);
};

BlockService.prototype._decodeTimestampBlockKey = function(buffer) {
  return buffer.readDoubleBE(2);
};

BlockService.prototype._encodeTimestampBlockValue = function(hash) {
  return new Buffer(hash, 'hex');
};

BlockService.prototype._decodeTimestampBlockValue = function(buffer) {
  return buffer.toString('hex');
};

module.exports = BlockService;
