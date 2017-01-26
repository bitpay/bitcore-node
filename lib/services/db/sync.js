'use strict'
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;

function Sync(node, db) {
  this.node = node;
  this.db = db;
  this.syncing = false;
  this.highWaterMark = 100;
}

inherits(Sync, EventEmitter);

// Use a concurrent strategy to sync
Sync.prototype.initialSync = function() {
  var self = this;

  if(this.syncing) {
    return
  }

  this.syncing = true;
  this.blockStream = new BlockStream(this.highWaterMark, this.node.services.bitcoind, this.db.tip.__height);
  var processConcurrent = new ProcessConcurrent(this.highWaterMark, this.db);
  var processSerial = new ProcessSerial(this.highWaterMark, this.db, this.db.tip);
  var writeStream1 = new WriteStream(this.highWaterMark, this.db);
  var writeStream2 = new WriteStream(this.highWaterMark, this.db);

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
    this.blockStream.stopping = true;
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

function BlockStream(highWaterMark, bitcoind, lastHeight) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.bitcoind = bitcoind;
  this.lastHeight = lastHeight;
  this.stopping = false;
  this.queue = [];
  this.processing = false;
}

inherits(BlockStream, Readable);

// BlockStream.prototype._read = function() {
//   var self = this;

//   // TODO does not work :(

//   var blockCount = Math.min(self.bitcoind.height - self.lastHeight, 5);

//   if(blockCount <= 0 || this.stopping) {
//     return self.push(null);
//   }

//   console.log('Fetching blocks ' + (self.lastHeight + 1) + ' to ' + (self.lastHeight + blockCount));

//   async.times(blockCount, function(n, next) {
//     var height = self.lastHeight + n + 1;
//     self.bitcoind.getBlock(height, function(err, block) {
//       if(err) {
//         return next(err);
//       }

//       block.__height = height;

//       next(null, block);
//     });
//   }, function(err, blocks) {
//     if(err) {
//       return self.emit('error', err);
//     }

//     for(var i = 0; i < blocks.length; i++) {
//       self.push(blocks[i]);
//     }

//     self.lastHeight += blocks.length;
//   });
// };

// BlockStream.prototype._read = function() {
//   var self = this;

//   self.lastHeight++;
//   //console.log('Fetching block ' + self.lastHeight);

//   var height = self.lastHeight;

//   self.bitcoind.getBlock(height, function(err, block) {
//     if(err) {
//       return self.emit(err);
//     }

//     block.__height = height;

//     //console.log('pushing block ' + block.__height);
//     self.push(block);
//   });
// };

BlockStream.prototype._read = function() {
  this.lastHeight++;
  this.queue.push(this.lastHeight);

  this._process();
};

BlockStream.prototype._process = function() {
  var self = this;

  if(this.processing) {
    return;
  }

  this.processing = true;

  async.whilst(
    function() {
      return self.queue.length;
    }, function(next) {
      var heights = self.queue.slice(0, Math.min(5, self.queue.length));
      self.queue = self.queue.slice(heights.length);

      //console.log('fetching blocks ' + heights[0] + ' to ' + heights[heights.length - 1]);

      async.map(heights, function(height, next) {
        self.bitcoind.getBlock(height, function(err, block) {
          if(err) {
            return next(err);
          }

          block.__height = height;

          next(null, block);
        });
      }, function(err, blocks) {
        if(err) {
          return next(err);
        }

        for(var i = 0; i < blocks.length; i++) {
          self.push(blocks[i]);
        }

        next();
      });
    }, function(err) {
      if(err) {
        return self.emit('error', err);
      }

      self.processing = false;
    }
  );
}

function ProcessSerial(highWaterMark, db, tip) {
  Transform.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.tip = tip;
}

inherits(ProcessSerial, Transform);

ProcessSerial.prototype._transform = function(block, enc, callback) {
  var self = this;

  //console.log('serial', block.__height);

  var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');
  if(prevHash !== self.tip.hash) {
    var err = new Error('Reorg detected');
    err.reorg = true;
    return callback(err);
  }

  async.whilst(
    function() {
      return self.db.concurrentTip.__height < block.__height;
    },
    function(next) {
      // wait until concurrent handler is ahead of us
      setTimeout(next, 10);
    },
    function() {
      self.db.getSerialBlockOperations(block, true, function(err, operations) {
        if(err) {
          return callback(err);
        }

        var obj = {
          tip: block,
          operations: operations
        };

        self.tip = block;

        callback(null, obj);
      });
    }
  );
};

function ProcessConcurrent(highWaterMark, db) {
  Transform.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.operations = [];
  this.lastBlock = 0;
  this.blockCount = 0;
};

inherits(ProcessConcurrent, Transform);

ProcessConcurrent.prototype._transform = function(block, enc, callback) {
  var self = this;

  //console.log('concurrent', block.__height);

  this.lastBlock = block;

  self.db.getConcurrentBlockOperations(block, true, function(err, operations) {
    if(err) {
      return callback(err);
    }

    self.blockCount++;
    self.operations = self.operations.concat(operations);

    if(self.blockCount >= 1) { //self.operations.length >= 100) {
      self.operations.push(self.db.getConcurrentTipOperation(block, true));
      var obj = {
        concurrentTip: block,
        operations: self.operations
      }
      self.operations = [];
      self.blockCount = 0;

      return callback(null, obj);
    }

    callback();
  });
};

ProcessConcurrent.prototype._flush = function(callback) {
  if(this.operations.length) {
    this.operations.push(this.db.getConcurrentTipOperation(this.lastBlock, true));
    var obj = {
      concurrentTipHeight: this.lastBlock,
      operations: this.operations
    };

    this.operations = [];
    return callback(null, operations);
  }
};

function WriteStream(highWaterMark, db) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.writeTime = 0;
  this.lastConcurrentOutputHeight = 0;
}

inherits(WriteStream, Writable);

WriteStream.prototype._write = function(obj, enc, callback) {
  var self = this;

  self.db.store.batch(obj.operations, function(err) {
    if(err) {
      return callback(err);
    }

    if(obj.tip) {
      self.db.tip = obj.tip;
      if(self.db.tip.__height % 100 === 0) {
        console.log('Tip:', self.db.tip.__height);
      }
    }

    if(obj.concurrentTip) {
      self.db.concurrentTip = obj.concurrentTip;
      if(self.db.concurrentTip.__height - self.lastConcurrentOutputHeight >= 100) {
        console.log('Concurrent tip:', self.db.concurrentTip.__height);
        self.lastConcurrentOutputHeight = self.db.concurrentTip.__height;
      }
    }

    callback();
  });
};

module.exports = Sync;