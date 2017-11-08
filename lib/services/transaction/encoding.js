'use strict';

var Tx = require('bcoin').tx;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.txIndex = new Buffer('00', 'hex');
  this.spentIndex = new Buffer('01', 'hex');
  this.doubleSpentIndex = new Buffer('02', 'hex');
}

Encoding.prototype.encodeTransactionKey = function(txid) {
  return Buffer.concat([this.servicePrefix, this.txIndex, new Buffer(txid, 'hex')]);
};

Encoding.prototype.decodeTransactionKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeTransactionValue = function(transaction) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(transaction.__height);

  var hashBuffer = new Buffer(transaction.__blockhash, 'hex');

  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(transaction.__timestamp);

  var inputValues = transaction.__inputValues;
  var inputValuesBuffer = new Buffer(8 * inputValues.length);
  for(var i = 0; i < inputValues.length; i++) {
    inputValuesBuffer.writeDoubleBE(inputValues[i], i * 8);
  }

  var inputValuesLengthBuffer = new Buffer(2);
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length);

  return new Buffer.concat([heightBuffer, hashBuffer, timestampBuffer,
    inputValuesLengthBuffer, inputValuesBuffer, transaction.toRaw()]);
};

Encoding.prototype.decodeTransactionValue = function(buffer) {
  var height = buffer.readUInt32BE();

  var blockhash = buffer.slice(4, 36).toString('hex');

  var timestamp = buffer.readUInt32BE(36);

  var inputValuesLength = buffer.readUInt16BE(40);

  var inputValues = [];
  for(var i = 0; i < inputValuesLength; i++) {
    inputValues.push(buffer.readDoubleBE(i * 8 + 42));
  }

  var txBuf = buffer.slice(inputValues.length * 8 + 42);
  var transaction = Tx.fromRaw(txBuf);

  transaction.__height = height;
  transaction.__blockhash = blockhash;
  transaction.__inputValues = inputValues;
  transaction.__timestamp = timestamp;
  return transaction;
};

// for every input we receive, we make an entry for what output it spends
Encoding.prototype.encodeSpentKey = function(txid, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([this.servicePrefix, this.spentIndex, new Buffer(txid, 'hex'), outputIndexBuffer]);
};

Encoding.prototype.decodeSpentKey = function(buffer) {
  var txid = buffer.slice(3, 35).toString('hex');
  var outputIndex = buffer.readUInt32BE(35);
  return {
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeSpentValue = function(txid, inputIndex, blockHeight, blockHash) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  var blockHeightBuffer = new Buffer(4);
  blockHeightBuffer.writeUInt32BE(blockHeight);
  var blockHashBuffer = new Buffer(blockHash, 'hex');
  return Buffer.concat([new Buffer(txid, 'hex'), inputIndexBuffer, blockHeightBuffer, blockHashBuffer]);
};

Encoding.prototype.decodeSpentValue = function(buffer) {
  var txid = buffer.slice(0, 32).toString('hex');
  var inputIndex = buffer.readUInt32BE(32);
  var blockHeight = buffer.readUInt32BE(36, 40);
  var blockHash = buffer.slice(40).toString('hex');
  return {
    txid: txid,
    inputIndex: inputIndex,
    blockHeight: blockHeight,
    blockHash: blockHash
  };
};

Encoding.prototype.encodeDoubleSpentKey = function(txid, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([this.servicePrefix, this.spentIndex, new Buffer(txid, 'hex'), outputIndexBuffer]);
};

Encoding.prototype.decodeDoubleSpentKey = function(buffer) {
  var txid = buffer.slice(3, 35).toString('hex');
  var outputIndex = buffer.readUInt32BE(35);
  return {
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeDoubleSpentValue = function(txid, inputIndex, blockHeight, blockHash) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  var blockHeightBuffer = new Buffer(4);
  blockHeightBuffer.writeUInt32BE(inputIndex);
  var blockHashBuffer = new Buffer(blockHash, 'hex');
  return Buffer.concat([new Buffer(txid, 'hex'), inputIndexBuffer, blockHeightBuffer, blockHashBuffer]);
};

Encoding.prototype.decodeDoubleSpentValue = function(buffer) {
  var txid = buffer.slice(0, 32).toString('hex');
  var inputIndex = buffer.readUInt32BE(32, 36);
  var blockHeight = buffer.readUInt32BE(36, 40);
  var blockHash = buffer.slice(40).toString('hex');
  return {
    txid: txid,
    inputIndex: inputIndex,
    blockHeight: blockHeight,
    blockHash: blockHash
  };
};

module.exports = Encoding;

