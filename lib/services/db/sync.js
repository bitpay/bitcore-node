'use strict';
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var ProgressBar = require('progress');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

function BlockStream(highWaterMark, bitcoind, dbTip) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.bitcoind = bitcoind;
  this.dbTip = dbTip;
  this.lastReadHeight = dbTip.__height;
  this.lastEmittedHash = dbTip.hash;
  this.stopping = false;
  this.queue = [];
  this.processing = false;
  this.syncing = true;
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
  this.processBlockStartTime = [];
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
  this.progressBar = null;
  this.lastReportedBlock = 0;
}

inherits(Sync, EventEmitter);

Sync.prototype.initialSync = function() {
  var self = this;

  if(this.syncing || this.db.reorg) {
    return;
  }

  self.syncing = true;

  self.blockStream = new BlockStream(self.highWaterMark, self.node.services.bitcoind, self.db.tip);
  var processConcurrent = new ProcessConcurrent(self.highWaterMark, self.db);
  var writeStream = new WriteStream(self.highWaterMark, self.db);
  var processSerial = new ProcessSerial(self.highWaterMark, self.db, self.db.tip);

  self._handleErrors(self.blockStream);
  self._handleErrors(processConcurrent);
  self._handleErrors(processSerial);
  self._handleErrors(writeStream);


  self.blockStream
    .pipe(processConcurrent)
    .pipe(writeStream);
  self.blockStream
    .pipe(processSerial);

  self.lastReportedBlock = self.db.tip.__height;
  self.progressBar = new ProgressBar('[:bar] :percent :current blks, :blockspersec blks/sec, :elapsed secs', {
    complete: green,
    incomplete: red,
    total: self.node.services.bitcoind.height,
    clear: true
  });

  self.progressBar.tick(self.db.tip.__height, {
    blockspersec: 0
  });

  var timer = setInterval(function () {
    var tick = self.db.tip.__height - self.lastReportedBlock;
    self.progressBar.tick(tick, { blockspersec: tick });
    self.lastReportedBlock = self.db.tip.__height;
  }, 1000);

  processSerial.on('finish', function() {
    self.syncing = false;
    if (self.progressBar) {
      self.progressBar.terminate();
    }
    if (timer) {
      clearInterval(timer);
    }
    self.emit('synced');
  });

};

Sync.prototype.sync = function() {
  var self = this;
  if(this.syncing || this.db.reorg) {
    return;
  }

  this.syncing = true;
  this.blockStream = new BlockStream(this.highWaterMark, this.node.services.bitcoind, this.db.tip);
  var processBoth = new ProcessBoth(this.highWaterMark, this.db);

  this._handleErrors(this.blockStream);
  this._handleErrors(processBoth);

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

  stream.on('error', function(err, block) {
    self.syncing = false;

    if(err.reorg) {
      return self.emit('reorg', block);
    }

    if(err.reorg2) {
      return;
    }

    self.emit('error', err);
  });
};


BlockStream.prototype._read = function() {

  if (this.lastEmittedHash === this.bitcoind.tiphash) {
    return this.push(null);
  }

  this.queue.push(++this.lastReadHeight);
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

      var heights = self.queue.slice(0, Math.min(5, self.queue.length));
      self.queue = self.queue.slice(heights.length);
      async.map(heights, function(height, next) {

        self.bitcoind.getBlock(height, function(err, block) {

          if(err) {
            return next(err);
          }

          block.__height = height;

          setTimeout(function() {
            next(null, block);
          }, 1);
        });

      }, function(err, blocks) {
        if(err) {
          return next(err);
        }

        for(var i = 0; i < blocks.length; i++) {

          self.lastEmittedHash = blocks[i].hash;
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

  var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');
  if(prevHash !== self.tip.hash) {
    var err = new Error('Reorg detected');
    err.reorg = true;
    return self.emit('error', err, block);
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

      callback();
    });
  });
};


ProcessConcurrent.prototype._transform = function(block, enc, callback) {
  var self = this;

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

  if(self.db.reorg) {
    var err = new Error('reorg in process');
    err.reorg2 = true;
    return callback(err);
  }

  self.db.store.batch(obj.operations, function(err) {
    if(err) {
      return callback(err);
    }

    self.db.concurrentTip = obj.concurrentTip;
    self.db.emit('concurrentaddblock');
    self.lastConcurrentOutputHeight = self.db.concurrentTip.__height;
    callback();
  });
};

ProcessBoth.prototype._write = function(block, encoding, callback) {
  var self = this;

  if(self.db.reorg) {
    var err = new Error('reorg in process');
    err.reorg2 = true;
    return callback(err);
  }

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
