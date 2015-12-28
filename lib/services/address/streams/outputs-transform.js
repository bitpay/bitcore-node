'use strict';

var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var bitcore = require('bitcore-lib');
var encodingUtil = require('../encoding');
var $ = bitcore.util.preconditions;

function OutputsTransformStream(options) {
  Transform.call(this, {
    objectMode: true
  });
  $.checkArgument(options.address instanceof bitcore.Address);
  this._address = options.address;
  this._addressStr = this._address.toString();
  this._tipHeight = options.tipHeight;
}
inherits(OutputsTransformStream, Transform);

OutputsTransformStream.prototype._transform = function(chunk, encoding, callback) {
  var self = this;

  var key = encodingUtil.decodeOutputKey(chunk.key);
  var value = encodingUtil.decodeOutputValue(chunk.value);

  var output = {
    address: this._addressStr,
    hashType: this._address.type,
    txid: key.txid.toString('hex'), //TODO use a buffer
    outputIndex: key.outputIndex,
    height: key.height,
    satoshis: value.satoshis,
    script: value.scriptBuffer.toString('hex'), //TODO use a buffer
    confirmations: this._tipHeight - key.height + 1
  };

  self.push(output);
  callback();

};

module.exports = OutputsTransformStream;
