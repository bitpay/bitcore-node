'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeAddressIndexKey = function(address, height, txid, index, input) {
  var prefix = new Buffer('00', 'hex');
  var buffers = [this.servicePrefix, prefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height || 0);
  buffers.push(heightBuffer);

  var txidBuffer = new Buffer(txid || Array(65).join('0'), 'hex');
  buffers.push(txidBuffer);

  var indexBuffer = new Buffer(4);
  indexBuffer.writeUInt32BE(index || 0);
  buffers.push(indexBuffer);

  // this is whether the address appears in an input (1) or output (0)
  var inputBuffer = new Buffer(1);
  inputBuffer.writeUInt8(input || 0);
  buffers.push(inputBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeAddressIndexKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var height = reader.readUInt32BE();
  var txid = reader.read(32).toString('hex');
  var index = reader.readUInt32BE();
  var input = reader.readUInt8();
  return {
    address: address,
    height: height,
    txid: txid,
    index: index,
    input: input
  };
};

Encoding.prototype.encodeUtxoIndexKey = function(address, txid, outputIndex) {
  var prefix = new Buffer('01', 'hex');
  var buffers = [this.servicePrefix, prefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  var txidBuffer = new Buffer(txid || new Array(65).join('0'), 'hex');
  buffers.push(txidBuffer);

  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex || 0);
  buffers.push(outputIndexBuffer);

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

module.exports = Encoding;

