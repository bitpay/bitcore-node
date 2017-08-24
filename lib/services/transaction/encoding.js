'use strict';

var Tx = require('bcoin').tx;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeTransactionKey = function(txid) {
  return Buffer.concat([this.servicePrefix, new Buffer(txid, 'hex')]);
};

Encoding.prototype.decodeTransactionKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

// TODO: maybe we should be storing the block hash here too.
Encoding.prototype.encodeTransactionValue = function(transaction) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(transaction.__height);

  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(transaction.__timestamp);

  var inputValues = transaction.__inputValues;
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }

  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length);

  return new Buffer.concat([heightBuffer, timestampBuffer,
    inputValuesLengthBuffer, inputValuesBuffer, transaction.toRaw()]);
};

Encoding.prototype.decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();
  var timestamp = buffer.readUInt32BE(4);

  var inputValuesLength = buffer.readUInt16BE(8);
  var inputValues = [];
  for(var i = 0; i < inputValuesLength; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 10));
  }

  var txBuf = buffer.slice(inputValues.length * 8 + 10);
  var transaction = Tx.fromRaw(txBuf);

  transaction.__height = height;
  transaction.__inputValues = inputValues;
  transaction.__timestamp = timestamp;
  return transaction;
};

module.exports = Encoding;

