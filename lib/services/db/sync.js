'use strict';
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var Block = bitcore.Block;
var ProgressBar = require('progress');
var index = require('../../index');
var log = index.log;

function BlockStream(highWaterMark, db, sync) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.sync = sync;
  this.db = db;
  this.dbTip = this.db.tip;
  this.lastReadHeight = this.dbTip.__height;
  this.lastEmittedHash = this.dbTip.hash;
  this.queue = [];
  this.processing = false;
  this.bitcoind = this.db.bitcoind;
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
  this.paused = false; //we can't sync while one of our indexes is reading/writing separate from us
  this.highWaterMark = 10;
  this.progressBar = null;
  this.lastReportedBlock = 0;
}

inherits(Sync, EventEmitter);

Sync.prototype.sync = function() {
  var self = this;

  if(this.syncing || this.paused) {
    log.debug('Sync lock held, not able to sync at the moment');
    return;
  }

  self.syncing = true;

  var blockStream = new BlockStream(self.highWaterMark, self.db, self);
  var processConcurrent = new ProcessConcurrent(self.highWaterMark, self.db);
  var writeStream = new WriteStream(self.highWaterMark, self.db);
  var processSerial = new ProcessSerial(self.highWaterMark, self.db, self.db.tip);

  self._handleErrors(blockStream);
  self._handleErrors(processConcurrent);
  self._handleErrors(processSerial);
  self._handleErrors(writeStream);

  blockStream
    .pipe(processConcurrent)
    .pipe(writeStream);
  blockStream
    .pipe(processSerial);

  self.lastReportedBlock = self.db.tip.__height;

  self.progressBar = new ProgressBar('[:bar] :percent :current blks, :blockspersec blks/sec', {
    curr: self.lastReportedBlock,
    total: self.node.services.bitcoind.height,
    clear: true
  });

  self.progressBarTimer = setInterval(self.reportStatus.bind(self), 1000);

  processSerial.on('finish', self._onFinish.bind(self));

};

Sync.prototype._onFinish = function() {

  var self = this;
  self.syncing = false;

  if (self.progressBar) {
    self.progressBar.terminate();
  }

  if (self.progressBarTimer) {
    clearInterval(self.progressBarTimer);
  }

  if (self.forkBlock) {
    self.db.handleReorg(self.forkBlock, function() {
      self.forkBlock = null;
      self.sync();
    });
    return;
  }

  self._startSubscriptions();
  self.emit('synced');

};

Sync.prototype._startSubscriptions = function() {

  var self = this;

  if (!self.subscribed) {

    self.subscribed = true;
    self.bus = self.node.openBus({remoteAddress: 'localhost'});

    self.bus.on('bitcoind/hashblock', function() {
      self.sync();
    });

    self.bus.subscribe('bitcoind/hashblock');
  }

};

Sync.prototype.reportStatus = function() {
  if (process.stderr.isTTY) {
    var tick = this.db.tip.__height - this.lastReportedBlock;
    this.progressBar.tick(tick, { blockspersec: tick });
    this.lastReportedBlock = this.db.tip.__height;
  } else {
    log.info('Sync: current height is: ' + this.db.tip.__height);
  }
};

Sync.prototype._handleErrors = function(stream) {
  var self = this;

  stream.on('error', function(err) {
    self.syncing = false;
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

      var blockArgs = self.queue.slice(0, Math.min(5, self.queue.length));
      self.queue = self.queue.slice(blockArgs.length);
      self._getBlocks(blockArgs, next);

    }, function(err) {
      if(err) {
        return self.emit('error', err);
      }
      self.processing = false;
    }
  );
};


BlockStream.prototype._getBlocks = function(heights, callback) {

  var self = this;
  async.map(heights, function(height, next) {

    if (height === 0) {
      var block = new Block(self.bitcoind.genesisBuffer);
      block.__height = 0;
      return next(null, block);
    }

    self.bitcoind.getBlock(height, function(err, block) {

      if(err) {
        return next(err);
      }

      block.__height = height;
      next(null, block);
    });


  }, function(err, blocks) {

    if(err) {
      return callback(err);
    }

    //at this point, we know that all blocks we've sent down the pipe
    //have not been reorg'ed, but the new batch here might have been
    self.sync.forkBlock = self.db.detectReorg(blocks);

    if (!self.sync.forkBlock) {

      for(var i = 0; i < blocks.length; i++) {

        self.lastEmittedHash = blocks[i].hash;
        self.push(blocks[i]);

      }

      return callback();

    }

    self.push(null);
    callback();

  });
};

ProcessSerial.prototype._write = function(block, enc, callback) {
  var self = this;

  function check() {
    return self.db.concurrentTip.__height >= block.__height;
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

    if(self.blockCount >= 1) {
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

  if (self.db.node.stopping) {
    return setImmediate(callback);
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
