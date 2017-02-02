'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeMempoolAddressIndexKey = function(address, txid) {
  var prefix = new Buffer('00', 'hex');
  var buffers = [this.servicePrefix, prefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  buffers.push(addressSizeBuffer);
  var addressBuffer = new Buffer(address, 'utf8');
  buffers.push(addressBuffer);

  var txidBuffer = new Buffer(txid, 'hex');
  buffers.push(txidBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeMempoolAddressIndexKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var txid = reader.read(32).toString('hex');

  return {
    address: address,
    txid: txid
  };
};

Encoding.prototype.encodeMempoolTransactionKey = function(txid) {
  var prefix = new Buffer('01', 'hex');
  var buffers = [this.servicePrefix, prefix];
  var txidBuffer = new Buffer(txid, 'hex');
  buffers.push(txidBuffer);
  return Buffer.concat(buffers);
};

Encoding.prototype.decodeMempoolTransactionKey = function(buffer) {
  return buffer.slice(4).toString('hex');
};

Encoding.prototype.encodeMempoolTransactionValue = function(transaction) {
  var inputValues = transaction.__inputValues || [];
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }
  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length * 8);
  return new Buffer.concat([inputValuesLengthBuffer, inputValuesBuffer, transaction.toBuffer()]);
};

Encoding.prototype.decodeMempoolTransactionValue = function(buffer) {
  var inputValues = [];
  var inputValuesLength = buffer.readUInt16BE();
  for(var i = 0; i < inputValuesLength / 8; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 2));
  }
  var transaction = new bitcore.Transaction(buffer.slice(inputValues.length * 8 + 2));
  transaction.__inputValues = inputValues;
  return transaction;
};

module.exports = Encoding;

