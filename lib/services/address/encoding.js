'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.getTerminalKey = function(startKey) {
  var endKey = Buffer.from(startKey);
  endKey.writeUInt8(startKey.readUInt8(startKey.length - 1) + 1, startKey.length - 1);
  return endKey;
};

Encoding.prototype.encodeAddressIndexKey = function(address, height, txid) {
  var prefix = new Buffer('00', 'hex');
  var buffers = [this.servicePrefix, prefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  if(height !== undefined) {
    var heightBuffer = new Buffer(4);
    heightBuffer.writeUInt32BE(height);
    buffers.push(heightBuffer);
  }

  if(txid) {
    var txidBuffer = new Buffer(txid, 'hex');
    buffers.push(txidBuffer);
  }

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeAddressIndexKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var height = reader.readUInt32BE();
  var txid = reader.read(32).toString('hex');
  return {
    address: address,
    height: height,
    txid: txid,
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

  if(txid) {
    var txidBuffer = new Buffer(txid, 'hex');
    buffers.push(txidBuffer);
  }

  if(outputIndex !== undefined) {
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
  var reader = new BufferReader(buffer);
  var height = reader.readUInt32BE();
  var satoshis = reader.readDoubleBE();
  var scriptBuffer = reader.read(buffer.length - 12);
  return {
    height: height,
    satoshis: satoshis,
    script: scriptBuffer
  };
};

module.exports = Encoding;

