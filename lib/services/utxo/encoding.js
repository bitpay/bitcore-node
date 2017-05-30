'use strict';

var assert = require('assert');
var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.nonP2PKPrefix = new Buffer('00', 'hex');
  this.P2PKPrefix = new Buffer('01', 'hex');
}

Encoding.prototype.encodeUtxoIndexKey = function(address, txid, outputIndex) {

  assert(address, 'address is required');
  var buffers = [this.servicePrefix, this.nonP2PKPrefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  if (txid) {
    var txidBuffer = new Buffer(txid, 'hex');
    buffers.push(txidBuffer);
  }

  if (outputIndex >= 0) {
    var outputIndexBuffer = new Buffer(4);
    outputIndexBuffer.writeUInt32BE(outputIndex);
    buffers.push(outputIndexBuffer);
  }

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeUtxoIndexKey = function(buffer) {

  var reader = new BufferReader(buffer);
  reader.read(3);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var txid = reader.read(32).toString('hex');
  var outputIndex = reader.readUInt32BE(4);

  return {
    address: address,
    txid: txid,
    outputIndex: outputIndex
  };

};

Encoding.prototype.encodeUtxoIndexValue = function(height, satoshis, scriptBuffer) {

  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([heightBuffer, satoshisBuffer, scriptBuffer]);

};

Encoding.prototype.decodeUtxoIndexValue = function(buffer) {

  var height = buffer.readUInt32BE();
  var satoshis = buffer.readDoubleBE(4);
  var scriptBuffer = buffer.slice(12);
  return {
    height: height,
    satoshis: satoshis,
    script: scriptBuffer
  };

};

Encoding.prototype.encodeP2PKUtxoIndexKey = function(txid, outputIndex) {

  assert(txid, 'txid is required');
  var buffers = [this.servicePrefix, this.P2PKPrefix];

  var txidBuffer = new Buffer(txid);
  buffers.push(txidBuffer);

  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  buffers.push(outputIndexBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeP2PKUtxoIndexKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var txid = reader.read(32).toString('hex');
  var outputIndex = reader.readUInt32BE(4);

  return {
    address: address,
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeP2PKUtxoIndexValue = function(height, satoshis, scriptBuffer) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([heightBuffer, satoshisBuffer, scriptBuffer]);
};

Encoding.prototype.decodeP2PKUtxoIndexValue = function(buffer) {
  var height = buffer.readUInt32BE();
  var satoshis = buffer.readDoubleBE(4);
  var scriptBuffer = buffer.slice(12);
  return {
    height: height,
    satoshis: satoshis,
    script: scriptBuffer
  };
};

module.exports = Encoding;

