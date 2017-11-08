'use strict';
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var index = require('../../index');
var log = index.log;
var _ = require('lodash');

function BlockStream(highWaterMark, sync) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.sync = sync;
  this.block = this.sync.block;
  this.dbTip = this.block.tip;
  this.lastReadHeight = this._getTipHeight();
  this.lastEmittedHash = this.dbTip.hash;
  this.queue = [];
  this.processing = false;
  var self = this;
  self.block.on('reorg', function() {
    self.push(null);
  });
}

inherits(BlockStream, Readable);

function ProcessConcurrent(highWaterMark, sync) {
  Transform.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.block = sync.block;
  this.db = sync.db;
  this.operations = [];
  this.lastBlock = 0;
  this.blockCount = 0;
}

inherits(ProcessConcurrent, Transform);

function ProcessSerial(highWaterMark, sync) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.block = sync.block;
  this.db = sync.db;
  this.block = sync.block;
  this.tip = sync.block.tip;
  this.processBlockStartTime = [];
  this._lastReportedTime = Date.now();
}

inherits(ProcessSerial, Writable);

function ProcessBoth(highWaterMark, sync) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = sync.db;
}

inherits(ProcessBoth, Writable);

function WriteStream(highWaterMark, sync) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = sync.db;
  this.writeTime = 0;
  this.lastConcurrentOutputHeight = 0;
  this.block = sync.block;
}

inherits(WriteStream, Writable);

function BlockHandler(node, block) {
  this.node = node;
  this.db = this.node.services.db;
  this.block = block;
  this.syncing = false;
  this.paused = false;
  this.blockQueue = [];
  this.highWaterMark = 10;
}

inherits(BlockHandler, EventEmitter);

BlockHandler.prototype.sync = function(block) {
  var self = this;

  if (block) {
    self.blockQueue.push(block);
  }

  if(this.syncing || this.paused) {
    log.debug('Sync lock held, not able to sync at the moment');
    return;
  }

  self.syncing = true;

  self._setupStreams();

};

BlockHandler.prototype._setupStreams = function() {
  var self = this;
  var blockStream = new BlockStream(self.highWaterMark, self);
  var processConcurrent = new ProcessConcurrent(self.highWaterMark, self);
  var writeStream = new WriteStream(self.highWaterMark, self);
  var processSerial = new ProcessSerial(self.highWaterMark, self);

  self._handleErrors(blockStream);
  self._handleErrors(processConcurrent);
  self._handleErrors(processSerial);
  self._handleErrors(writeStream);

  blockStream
    .pipe(processConcurrent)
    .pipe(writeStream);
  blockStream
    .pipe(processSerial);

  processSerial.on('finish', self._onFinish.bind(self));

};

BlockHandler.prototype._onFinish = function() {

  var self = this;
  self.syncing = false;

  self.emit('synced');

};

BlockHandler.prototype._handleErrors = function(stream) {
  var self = this;

  stream.on('error', function(err) {
    self.syncing = false;
    self.emit('error', err);
  });
};


BlockStream.prototype._read = function() {

  if (this.lastEmittedHash === this.block.getNetworkTipHash()) {
    return this.push(null);
  }

  if (this.sync.blockQueue.length === 0) {
    this.queue.push(++this.lastReadHeight);
  } else {
    var block = this.sync.blockQueue.shift();
    if (block) {
      this.lastReadHeight = block.__height;
      this.queue.push(block);
    }
  }

  this._process();
};

BlockStream.prototype._process = function() {
  var self = this;

  if(self.processing) {
    return;
  }

  this.processing = true;

  async.whilst(
    function() {
      return self.queue.length;
    }, function(next) {

      var blockArgs = self.queue.slice(0, Math.min(5, self.queue.length));
      self.queue = self.queue.slice(blockArgs.length);

      if (_.isNumber(blockArgs[0])) {
        self.block.getBlocks(blockArgs, function(err, blocks) {

          if(err) {
            return next(err);
          }

          self._pushBlocks(blocks);
          next();

        });
      } else {

        self._pushBlocks(blockArgs);
        next();

      }

    }, function(err) {

      if(err) {
        return self.emit('error', err);
      }
      self.processing = false;

    }
  );
};

BlockStream.prototype._pushBlocks = function(blocks) {

  var self = this;

  for(var i = 0; i < blocks.length; i++) {

    self.lastEmittedHash = blocks[i].hash;
    self.push(blocks[i]);

  }

};

BlockStream.prototype._getTipHeight = function() {
  if (this.dbTip.__height === 0) {
    return -1;
  }
  return this.dbTip.__height;
};

ProcessSerial.prototype._reportStatus = function() {
  if ((Date.now() - this._lastReportedTime) > 1000) {
    this._lastReportedTime = Date.now();
    log.info('Sync: current height is: ' + this.block.tip.__height);
  }
};

ProcessSerial.prototype._write = function(block, enc, callback) {
  var self = this;

  function check() {
    return self.block.concurrentTip.__height >= block.__height;
  }

  if(check()) {
    return self._process(block, callback);
  }

  self.block.once('concurrentaddblock', function() {
    if(!check()) {
      var err = new Error('Concurrent block ' + self.block.concurrentTip.__height + ' is less than ' + block.__height);
      return self.emit('error', err);
    }
    self._process(block, callback);
  });

};

ProcessSerial.prototype._process = function(block, callback) {
  var self = this;

  self.block.getBlockOperations(block, true, 'serial', function(err, operations) {
    if(err) {
      return callback(err);
    }

    operations.push(self.block.getTipOperation(block, true));

    var obj = {
      tip: block,
      operations: operations
    };

    self.tip = block;

    self.db.batch(obj.operations, function(err) {
      if(err) {
        return callback(err);
      }

      self.block.tip = block;
      self._reportStatus();
      self.block.emit('addblock');

      callback();
    });
  });
};

ProcessConcurrent.prototype._transform = function(block, enc, callback) {
  var self = this;

  this.lastBlock = block;

  self.block.getBlockOperations(block, true, 'concurrent', function(err, operations) {
    if(err) {
      return callback(err);
    }

    self.blockCount++;
    self.operations = self.operations.concat(operations);

    if(self.blockCount >= 1) {
      self.operations.push(self.block.getTipOperation(block, true, 'concurrentTip'));
      var obj = {
        concurrentTip: block,
        operations: self.operations
      };
      self.operations = [];
      self.blockCount = 0;

      return callback(null, obj);
    }

    callback();
  });
};

ProcessConcurrent.prototype._flush = function(callback) {
  if(this.operations.length) {
    this.operations.push(this.block.getTipOperation(this.lastBlock, true));
    this.operations = [];
    return callback(null, this.operations);
  }
};

WriteStream.prototype._write = function(obj, enc, callback) {
  var self = this;

  if (self.db.node.stopping) {
    return setImmediate(callback);
  }

  self.db.batch(obj.operations, function(err) {
    if(err) {
      return callback(err);
    }

    self.block.concurrentTip = obj.concurrentTip;
    self.block.emit('concurrentaddblock');
    self.lastConcurrentOutputHeight = self.block.concurrentTip.__height;
    callback();
  });
};

ProcessBoth.prototype._write = function(block, encoding, callback) {
  var self = this;

  async.parallel([function(next) {
    self.block.getBlockOperations(block, true, 'concurrent', function(err, operations) {
      if(err) {
        return callback(err);
      }
      operations.push(self.block.getTipOperation(block, true, 'concurrentTip'));
      next(null, operations);
  });
  }, function(next) {
    self.block.getBlockOperations(block, true, 'serial', function(err, operations) {
      if(err) {
        return callback(err);
      }
      operations.push(self.block.getTipOperation(block, true));
      next(null, operations);
    });
  }], function(err, results) {
      if(err) {
        return callback(err);
      }
      var operations = results[0].concat(results[1]);
      self.db.batch(operations, function(err) {
        if(err) {
          return callback(err);
        }
        self.block.tip = block;
        self.block.concurrentTip = block;
        callback();
      });
  });
};

module.exports = BlockHandler;
