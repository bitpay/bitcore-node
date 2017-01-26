'use strict'
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;
var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var async = require('async');

function main() {
  var blockStream = new BlockStream();
  var processConcurrent = new ProcessConcurrent();
  var processSerial = new ProcessSerial();
  var writeStreamFast = new WriteStreamFast();
  var writeStreamSlow = new WriteStreamSlow();

  var start = Date.now();

  writeStreamFast.on('finish', function() {
    var end = Date.now();
    console.log('Total time: ', (end - start) + ' ms');
    console.log('Concurrent write time: ', writeStreamSlow.writeTime + ' ms');
    console.log('Serial write time: ', writeStreamFast.writeTime + ' ms');
  });

  blockStream
    .pipe(processConcurrent)
    .pipe(writeStreamSlow);

  blockStream
    .pipe(processSerial)
    .pipe(writeStreamFast);
}

function BlockStream() {
  Readable.call(this, {objectMode: true, highWaterMark: 10});
  this.height = 0;
}

inherits(BlockStream, Readable);

BlockStream.prototype._read = function() {
  var self = this;
  console.log('_read');

  setTimeout(function() {
    self.height++;
    if(self.height > 40) {
      self.push(null);
      return;
    }

    console.log('ReadStream block ', self.height);
    console.log(self.push({height: self.height}));
  }, 500);
};

function ProcessSerial() {
  Transform.call(this, {objectMode: true, highWaterMark: 10});
}

inherits(ProcessSerial, Transform);

ProcessSerial.prototype._transform = function(block, enc, callback) {
  var operations = [{index1: block.height}, {index2: block.height}];
  setTimeout(function() {
    var obj = {
      tipHeight: block.height,
      operations: operations
    };

    callback(null, obj);
  }, 100);
};

function ProcessConcurrent() {
  Transform.call(this, {objectMode: true, highWaterMark: 10});
  this.operations = [];
  this.lastHeight = 0;
};

inherits(ProcessConcurrent, Transform);

ProcessConcurrent.prototype._transform = function(block, enc, callback) {
  var self = this;

  self.lastHeight = block.height;

  setTimeout(function() {
    self.operations = self.operations.concat([{index3: block.height}, {index4: block.height}]);

    console.log(self.operations.length);
    if(self.operations.length >= 10) {
      var obj = {
        concurrentTipHeight: self.lastHeight,
        operations: self.operations
      };
      self.operations = [];

      return callback(null, obj);
    }

    callback();
  }, 100);
};

ProcessConcurrent.prototype._flush = function(callback) {
  if(this.operations.length) {
    var obj = {
      concurrentTipHeight: this.lastHeight,
      operations: this.operations
    };

    this.operations = [];
    return callback(null, operations);
  }
};

function WriteStreamSlow() {
  Writable.call(this, {objectMode: true, highWaterMark: 10});
  this.writeTime = 0;
}

inherits(WriteStreamSlow, Writable);

WriteStreamSlow.prototype._write = function(operations, enc, callback) {
  var self = this;
  setTimeout(function() {
    console.log('WriteStreamSlow block ', operations.concurrentTipHeight);
    self.writeTime += 2000;
    callback();
  }, 2000);
};

function WriteStreamFast() {
  Writable.call(this, {objectMode: true, highWaterMark: 1});
  this.writeTime = 0;
}

inherits(WriteStreamFast, Writable);

WriteStreamFast.prototype._write = function(operations, enc, callback) {
  var self = this;
  setTimeout(function() {
    console.log('WriteStreamFast block ', operations.tipHeight);
    self.writeTime += 1000;
    callback();
  }, 1000);
};

main();