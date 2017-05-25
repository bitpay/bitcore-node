'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeAddressIndexKey = function(address, height, txid) {
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

  var txidBuffer = new Buffer(txid || new Array(65).join('0'), 'hex');
  buffers.push(txidBuffer);

  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex || 0);
  buffers.push(outputIndexBuffer);

  return Buffer.concat(buffers);
};

module.exports = Encoding;

