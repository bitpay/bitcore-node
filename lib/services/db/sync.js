'use strict';
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var bitcore = require('bitcore-lib');
var index = require('../../index');
var log = index.log;

function BlockStream(highWaterMark, db, sync) {
  Readable.call(this, {objectMode: true, highWaterMark: highWaterMark});
  this.sync = sync;
  this.db = db;
  this.dbTip = this.db.tip;
  this.lastReadHeight = this.dbTip.__height;
  this.lastReadHash = this.dbTip.hash;
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
  this._lastReportedTime = Date.now();
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

  processSerial.on('finish', self._onFinish.bind(self));

};

Sync.prototype._onFinish = function() {
  var self = this;
  self.syncing = false;

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

Sync.prototype._handleErrors = function(stream) {
  var self = this;

  stream.on('error', function(err) {
    self.syncing = false;
    self.emit('error', err);
  });
};


BlockStream.prototype._read = function() {
  var self = this;

  if(this.lastReadHash === this.bitcoind.tiphash) {
    return this.push(null);
  }

  if(this.lastReadHeight >= this.bitcoind.height) {
    return this.push(null);
  }

  self.bitcoind.getBlock(self.lastReadHeight + 1, function(err, block) {
    if(err) {
      // add new stack lines to err
      return self.emit('error', new Error(err));
    }

    self.lastReadHeight++;
    self.lastReadHash = block.hash;

    block.__height = self.lastReadHeight;
    self.push(block);
  });
};

ProcessSerial.prototype._reportStatus = function() {
  if ((Date.now() - this._lastReportedTime) > 1000) {
    this._lastReportedTime = Date.now();
    log.info('Sync: current height is: ' + this.db.tip.__height);
  }
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

  if(self.db.detectReorg(block)) {
    return self.db.handleReorg(block, callback);
  }

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

    self.db.batch(obj.operations, function(err) {
      if(err) {
        return callback(err);
      }

      self.db.tip = block;
      self._reportStatus();
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

  self.db.batch(obj.operations, function(err) {
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
      self.db.batch(operations, function(err) {
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
