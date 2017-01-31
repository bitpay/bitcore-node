'use strict';

var Transform = require('stream').Transform;
var inherits = require('util').inherits;
var bitcore = require('bitcore-lib');
var encodingUtil = require('../../../encoding');
var $ = bitcore.util.preconditions;

function InputsTransformStream(options) {
  $.checkArgument(options.address instanceof bitcore.Address);
  Transform.call(this, {
    objectMode: true
  });
  this._address = options.address;
  this._addressStr = this._address.toString();
  this._tipHeight = options.tipHeight;
}
inherits(InputsTransformStream, Transform);

InputsTransformStream.prototype._transform = function(chunk, encoding, callback) {
  var self = this;

  var key = encodingUtil.decodeInputKey(chunk.key);
  var value = encodingUtil.decodeInputValue(chunk.value);

  var input = {
    address: this._addressStr,
    hashType: this._address.type,
    txid: value.txid.toString('hex'),
    inputIndex: value.inputIndex,
    height: key.height,
    confirmations: this._tipHeight - key.height + 1
  };

  self.push(input);
  callback();

};

module.exports = InputsTransformStream;
