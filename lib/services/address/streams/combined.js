'use strict';

var ReadableStream = require('stream').Readable;
var inherits = require('util').inherits;

function TransactionInfoStream(options) {
  ReadableStream.call(this, {
    objectMode: true
  });

  // TODO: Be able to specify multiple input and output streams
  // so that it's possible to query multiple addresses at the same time.
  this._inputStream = options.inputStream;
  this._outputStream = options.outputStream;

  // This holds a collection of combined inputs and outputs
  // grouped into the matching block heights.
  this._blocks = {};

  this._inputCurrentHeight = 0;
  this._outputCurrentHeight = 0;
  this._inputFinishedHeights = [];
  this._outputFinishedHeights = [];
  this._inputEnded = false;
  this._outputEnded = false;

  this._listenStreamEvents();
}

inherits(TransactionInfoStream, ReadableStream);

TransactionInfoStream.prototype._listenStreamEvents = function() {
  var self = this;

  self._inputStream.on('data', function(input) {
    self._addToBlock(input);
    if (input.height > self._inputCurrentHeight) {
      self._inputFinishedHeights.push(input.height);
    }
    self._inputCurrentHeight = input.height;
    self._maybePushBlock();
  });

  self._outputStream.on('data', function(output) {
    self._addToBlock(output);
    if (output.height > self._outputCurrentHeight) {
      self._outputFinishedHeights.push(output.height);
    }
    self._outputCurrentHeight = output.height;
    self._maybePushBlock();
  });

  self._inputStream.on('end', function() {
    self._inputFinishedHeights.push(self._inputCurrentHeight);
    self._inputEnded = true;
    self._maybeEndStream();
  });

  self._outputStream.on('end', function() {
    self._outputFinishedHeights.push(self._outputCurrentHeight);
    self._outputEnded = true;
    self._maybeEndStream();
  });

};

TransactionInfoStream.prototype._read = function() {
  this._inputStream.resume();
  this._outputStream.resume();
};

TransactionInfoStream.prototype._addToBlock = function(data) {
  if (!this._blocks[data.height]) {
    this._blocks[data.height] = [];
  }
  this._blocks[data.height].push(data);
};

TransactionInfoStream.prototype._maybeEndStream = function() {
  if (this._inputEnded && this._outputEnded) {
    this._pushRemainingBlocks();
    this.push(null);
  }
};

TransactionInfoStream.prototype._pushRemainingBlocks = function() {
  var keys = Object.keys(this._blocks);
  for (var i = 0; i < keys.length; i++) {
    this.push(this._blocks[keys[i]]);
    delete this._blocks[keys[i]];
  }
};

TransactionInfoStream.prototype._combineTransactionInfo = function(transactionInfo) {
  var combinedArrayMap = {};
  var combinedArray = [];
  var l = transactionInfo.length;
  for(var i = 0; i < l; i++) {
    var item = transactionInfo[i];
    var mapKey = item.txid;
    if (combinedArrayMap[mapKey] >= 0) {
      var combined = combinedArray[combinedArrayMap[mapKey]];
      if (!combined.addresses[item.address]) {
        combined.addresses[item.address] = {
          outputIndexes: [],
          inputIndexes: []
        };
      }
      if (item.outputIndex >= 0) {
        combined.satoshis += item.satoshis;
        combined.addresses[item.address].outputIndexes.push(item.outputIndex);
      } else if (item.inputIndex >= 0) {
        combined.addresses[item.address].inputIndexes.push(item.inputIndex);
      }
    } else {
      item.addresses = {};
      item.addresses[item.address] = {
        outputIndexes: [],
        inputIndexes: []
      };
      if (item.outputIndex >= 0) {
        item.addresses[item.address].outputIndexes.push(item.outputIndex);
      } else if (item.inputIndex >= 0) {
        item.addresses[item.address].inputIndexes.push(item.inputIndex);
      }
      delete item.outputIndex;
      delete item.inputIndex;
      delete item.address;
      combinedArray.push(item);
      combinedArrayMap[mapKey] = combinedArray.length - 1;
    }
  }
  return combinedArray;
};

TransactionInfoStream.prototype._maybePushBlock = function() {
  if (!this._inputFinishedHeights[0] && !this._outputFinishedHeights[0]) {
    return;
  }

  var inputFinished = this._inputFinishedHeights[0];
  var outputFinished = this._outputFinishedHeights[0];
  var bothFinished;

  if (inputFinished === outputFinished) {
    bothFinished = inputFinished;
    this._inputFinishedHeights.shift();
    this._outputFinishedHeights.shift();
  } else if (inputFinished <= outputFinished) {
    bothFinished = inputFinished;
    this._inputFinishedHeights.shift();
  } else if (outputFinished <= inputFinished) {
    bothFinished = outputFinished;
    this._outputFinishedHeights.shift();
  }

  if (bothFinished) {
    var block = this._combineTransactionInfo(this._blocks[bothFinished]);
    this.push(block);
    delete this._blocks[bothFinished];
    //this._inputStream.pause();
    //this._outputStream.pause();
  }
};

module.exports = TransactionInfoStream;
