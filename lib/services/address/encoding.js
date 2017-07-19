'use strict';

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeAddressIndexKey = function(address, height, txid, index, input, timestamp) {
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

  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp || 0);
  buffers.push(timestampBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeAddressIndexKey = function(buffer) {

  var addressSize = buffer.readUInt8(3);
  var address = buffer.slice(4, addressSize + 4).toString('utf8');
  var height = buffer.readUInt32BE(addressSize + 4);
  var txid = buffer.slice(addressSize + 8, addressSize + 40).toString('hex');
  var index = buffer.readUInt32BE(addressSize + 40);
  var input = buffer.readUInt8(addressSize + 44);
  var timestamp = buffer.readUInt32BE(addressSize + 45);
  return {
    address: address,
    height: height,
    txid: txid,
    index: index,
    input: input,
    timestamp: timestamp
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
  var addressSize = buffer.readUInt8(3);
  var address = buffer.slice(4, addressSize + 4).toString('utf8');
  var txid = buffer.slice(addressSize + 4, addressSize + 36).toString('hex');
  var outputIndex = buffer.readUInt32BE(addressSize + 36);

  return {
    address: address,
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeUtxoIndexValue = function(height, satoshis, timestamp, scriptBuffer) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp || 0);
  return Buffer.concat([heightBuffer, satoshisBuffer, timestampBuffer, scriptBuffer]);
};

Encoding.prototype.decodeUtxoIndexValue = function(buffer) {
  var height = buffer.readUInt32BE();
  var satoshis = buffer.readDoubleBE(4);
  var timestamp = buffer.readUInt32BE(12);
  var scriptBuffer = buffer.slice(16);
  return {
    height: height,
    satoshis: satoshis,
    timestamp: timestamp,
    script: scriptBuffer
  };
};

module.exports = Encoding;

