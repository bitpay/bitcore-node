'use strict';

var bitcore = require('bitcore-lib');

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeTransactionKey = function(txid) {
  return Buffer.concat([this.servicePrefix, new Buffer(txid, 'hex')]);
};

Encoding.prototype.decodeTransactionKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeTransactionValue = function(transaction) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(transaction.__height);

  var timestampBuffer = new Buffer(8);
  timestampBuffer.writeDoubleBE(transaction.__timestamp);

  var inputValues = transaction.__inputValues;
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }

  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length);

  return new Buffer.concat([heightBuffer, timestampBuffer,
    inputValuesLengthBuffer, inputValuesBuffer, transaction.toBuffer()]);
};

Encoding.prototype.decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();

  var timestamp = buffer.readDoubleBE(4);

  var inputValues = [];
  var inputValuesLength = buffer.readUInt16BE(12);
  for(var i = 0; i < inputValuesLength / 8; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 14));
  }
  var transaction = new bitcore.Transaction(buffer.slice(inputValues.length * 8 + 14));
  transaction.__height = height;
  transaction.__inputValues = inputValues;
  transaction.__timestamp = timestamp;
  return transaction;
};

module.exports = Encoding;

