'use strict';
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;

function BlockStream(highWaterMark, bitcoind, lastHeight) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.bitcoind = bitcoind;
  this.lastHeight = lastHeight;
  this.stopping = false;
  this.queue = [];
  this.processing = false;
}

inherits(BlockStream, Readable);

function ProcessConcurrent(highWaterMark, db) {
  Transform.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.operations = [];
  this.lastBlock = 0;
  this.blockCount = 0;
}

inherits(ProcessConcurrent, Transform);

function ProcessSerial(highWaterMark, db, tip) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.tip = tip;
}

inherits(ProcessSerial, Writable);

function ProcessBoth(highWaterMark, db) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
}

inherits(ProcessBoth, Writable);

function WriteStream(highWaterMark, db) {
  Writable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.db = db;
  this.writeTime = 0;
  this.lastConcurrentOutputHeight = 0;
}

inherits(WriteStream, Writable);

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
    return;
  }

  this.syncing = true;
  this.blockStream = new BlockStream(this.highWaterMark, this.node.services.bitcoind, this.db.tip.__height);
  var processConcurrent = new ProcessConcurrent(this.highWaterMark, this.db);
  var writeStream = new WriteStream(this.highWaterMark, this.db);
  var processSerial = new ProcessSerial(this.highWaterMark, this.db, this.db.tip);

  this._handleErrors(this.blockStream);
  this._handleErrors(processConcurrent);
  this._handleErrors(processSerial);
  this._handleErrors(writeStream);

  processSerial.on('finish', function() {
    self.syncing = false;
    self.emit('synced');
  });

  this.blockStream
    .pipe(processConcurrent)
    .pipe(writeStream);

  this.blockStream
    .pipe(processSerial);
};

// Get concurrent and serial block operations and write them together block by block
// Useful for when we are fully synced and we want to advance the concurrentTip and
// the tip together
Sync.prototype.sync = function() {
  var self = this;
  if(this.syncing) {
    return;
  }

  this.syncing = true;
  this.blockStream = new BlockStream(this.highWaterMark, this.node.services.bitcoind, this.db.tip.__height);
  var processBoth = new ProcessBoth(this.highWaterMark, this.db);

  this._handleErrors(this.blockStream);
  this._handleErrors(processBoth);

  //TODO what should happen here
  processBoth.on('finish', function() {
    self.syncing = false;
  });

  this.blockStream
    .pipe(processBoth);
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

          setTimeout(function() {
            // we're getting blocks from bitcoind too fast?
            // it pauses at 8100
            next(null, block);
          }, 1);
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
};


ProcessSerial.prototype._write = function(block, enc, callback) {
  var self = this;

  function check() {
    return self.db.concurrentTip.__height >= block.__height;
  }
  //console.log('serial', block.__height);

  var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');
  if(prevHash !== self.tip.hash) {
    var err = new Error('Reorg detected');
    err.reorg = true;
    return callback(err);
  }

  if(check()) {
    return self._process(block, callback);
  }

  self.db.once('concurrentaddblock', function() {
    if(!check()) {
      var err = new Error('Concurrent block ' + self.db.concurrentTip.__height + ' is less than ' + block.__height);
      return self.emit('error', err);
    }
    self._process(block, callback);
  });

};

ProcessSerial.prototype._process = function(block, callback) {
  var self = this;

  self.db.getSerialBlockOperations(block, true, function(err, operations) {
    if(err) {
      return callback(err);
    }

    operations.push(self.db.getTipOperation(block, true));

    var obj = {
      tip: block,
      operations: operations
    };

    self.tip = block;

    self.db.store.batch(obj.operations, function(err) {
      if(err) {
        return callback(err);
      }

      self.db.tip = block;
      self.db.emit('addblock');
      if(self.db.tip.__height % 100 === 0) {
        console.log('Tip:', self.db.tip.__height);
      }

      callback();
    });
  });
};


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
    this.operations.push(this.db.getConcurrentTipOperation(this.lastBlock, true));
    this.operations = [];
    return callback(null, this.operations);
  }
};

WriteStream.prototype._write = function(obj, enc, callback) {
  var self = this;

  self.db.store.batch(obj.operations, function(err) {
    if(err) {
      return callback(err);
    }

    self.db.concurrentTip = obj.concurrentTip;
    self.db.emit('concurrentaddblock');
    if(self.db.concurrentTip.__height - self.lastConcurrentOutputHeight >= 100) {
      console.log('Concurrent tip:', self.db.concurrentTip.__height);
      self.lastConcurrentOutputHeight = self.db.concurrentTip.__height;
    }

    callback();
  });
};

ProcessBoth.prototype._write = function(block, encoding, callback) {
  var self = this;
  async.parallel([function(next) {
    self.db.getConcurrentBlockOperations(block, true, function(err, operations) {
      if(err) {
        return callback(err);
      }
      operations.push(self.db.getConcurrentTipOperation(block, true));
      next(null, operations);
  });
  }, function(next) {
    self.db.getSerialBlockOperations(block, true, function(err, operations) {
      if(err) {
        return callback(err);
      }
      operations.push(self.db.getTipOperation(block, true));
      next(null, operations);
    });
  }], function(err, results) {
      if(err) {
        return callback(err);
      }
      var operations = results[0].concat(results[1]);
      self.db.store.batch(operations, function(err) {
        if(err) {
          return callback(err);
        }
        self.db.tip = block;
        self.db.concurrentTip = block;
        callback();
      });
  });
};

module.exports = Sync;
