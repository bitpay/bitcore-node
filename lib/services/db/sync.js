'use strict'
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');

function Sync(node) {
  this.node = node;
  this.db = node.db;
  this.syncing = false;
}

inherits(Sync, EventEmitter);

// Use a concurrent strategy to sync
Sync.prototype.initialSync = function() {
  var self = this;

  if(this.syncing) {
    return
  }

  this.syncing = true;
  this.blockStream = new BlockStream(this.node.services.bitcoind, this.db.tip);
  var processConcurrent = new ProcessConcurrent(this.db);
  var processSerial = new ProcessSerial(this.db);
  var writeStream1 = new WriteStream(this.db);
  var writeStream2 = new WriteStream(this.db);

  var start = Date.now();

  this._handleErrors(this.blockStream);
  this._handleErrors(processConcurrent);
  this._handleErrors(processSerial);
  this._handleErrors(writeStream1);
  this._handleErrors(writeStream2);

  writeStream2.on('finish', function() {
    var end = Date.now();
    console.log('Total time: ', (end - start) + ' ms');
    console.log('Concurrent write time: ', writeStreamSlow.writeTime + ' ms');
    console.log('Serial write time: ', writeStreamFast.writeTime + ' ms');

    self.syncing = false;
    self.emit('initialsync');
  });

  this.blockStream
    .pipe(processConcurrent)
    .pipe(writeStream1);

  this.blockStream
    .pipe(processSerial)
    .pipe(writeStream2);
};

// Get concurrent and serial block operations and write them together block by block
// Useful for when we are fully synced and we want to advance the concurrentTip and 
// the tip together
Sync.prototype.sync = function() {
  if(this.syncing) {
    return
  }

  this.syncing = true;
  this.blockStream = new BlockStream();
  var processBoth = new ProcessBoth(this.db);
  var writeStream = new WriteStream(this.db);

  var start = Date.now();

  this._handleErrors(this.blockStream);
  this._handleErrors(processBoth);
  this._handleErrors(writeStream);

  writeStream.on('finish', function() {
    var end = Date.now();
    console.log('Total time: ', (end - start) + ' ms');
    console.log('Concurrent write time: ', writeStreamSlow.writeTime + ' ms');
    console.log('Serial write time: ', writeStreamFast.writeTime + ' ms');
    self.emit('synced');
  });

  this.blockStream
    .pipe(processBoth)
    .pipe(writeStream1);
};

Sync.prototype.stop = function() {
  if(this.blockStream) {
    this.blockStream.destroy();
  }
};

Sync.prototype._handleErrors = function(stream) {
  var self = this;

  stream.on('error', function(err) {
    self.syncing = false;

    if(err.reorg) {
      return self.emit('reorg');
    }

    self.emit('error', err);
  });
};

function BlockStream(bitcoind, lastHeight) {
  Readable.call(this, {objectMode: true, highWaterMark: 10});
  this.bitcoind = bitcoind;
  this.lastHeight = lastHeight;
}

inherits(BlockStream, Readable);

BlockStream.prototype._read = function() {
  var self = this;

  var blockCount = Math.min(self.bitcoind.height - self.lastHeight, 5);

  if(blockCount <= 0) {
    return self.push(null);
  }

  console.log('Fetching blocks ' + (self.lastHeight + 1) + ' to ' (self.lastHeight + blockCount.length));

  async.times(blockCount, function(n, next) {
    var height = self.lastHeight + n + 1;
    self.bitcoind.getBlock(height, function(err, block) {
      if(err) {
        return next(err);
      }

      next(null, block);
    });
  }, function(err, blocks) {
    if(err) {
      return self.emit('error', err);
    }

    for(var i = 0; i < blocks.length; i++) {
      self.push(blocks[i]);
    }

    self.lastHeight += blocks.length;
  });
};

function ProcessSerial(db, tip) {
  Transform.call(this, {objectMode: true, highWaterMark: 10});
  this.db = db;
  this.tip = tip;
}

inherits(ProcessSerial, Transform);

ProcessSerial.prototype._transform = function(block, enc, callback) {
  var self = this;

  var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');
  if(prevHash !== self.tip) {
    var err = new Error('Reorg detected');
    err.reorg = true;
    return callback(err);
  }

  async.whilst(
    function() {
      return self.db.concurrentHeight < block.__height;
    },
    function(next) {
      setTimeout(next, 1000);
    },
    function() {
      var operations = [{index1: block.height}, {index2: block.height}];
      setTimeout(function() {
        var obj = {
          tipHeight: block.height,
          operations: operations
        };

        callback(null, obj);
      }, 100);
    }
  );
};

function ProcessConcurrent(db) {
  Transform.call(this, {objectMode: true, highWaterMark: 10});
  this.db = db;
  this.operations = [];
  this.lastHeight = 0;
};

inherits(ProcessConcurrent, Transform);

ProcessConcurrent.prototype._transform = function(block, enc, callback) {
  var self = this;

  this.lastHeight = block.__height;

  self.db.runAllConcurrentBlockHandlers(block, true, function(err, operations) {
    if(err) {
      return callback(err);
    }

    self.operations = self.operations.concat(operations);

    if(self.operations >= 100) {
      // TODO add tip operation
      var obj = {
        concurrentTipHeight: block.__height,
        operations: self.operations
      }
      self.operations = [];

      return callback(null, obj);
    }

    callback();
  });
};

ProcessConcurrent.prototype._flush = function(callback) {
  if(this.operations.length) {
    // TODO add tip operation
    var obj = {
      concurrentTipHeight: this.lastHeight,
      operations: this.operations
    };

    this.operations = [];
    return callback(null, operations);
  }
};

function WriteStream(db) {
  Writable.call(this, {objectMode: true, highWaterMark: 10});
  this.db = db;
  this.writeTime = 0;
}

inherits(WriteStream, Writable);

WriteStream.prototype._write = function(obj, enc, callback) {
  var self = this;
  setTimeout(function() {
    console.log('WriteStreamSlow block ', operations.concurrentTipHeight);
    self.writeTime += 2000;

    if(obj.tip) {
      self.db.tip = obj.tip;
    }

    if(obj.concurrentTip) {
      self.db.concurrentTip = obj.concurrentTip;
    }

    callback();
  }, 2000);
};

module.exports = Sync;