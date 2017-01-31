'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;
var utils = require('./utils');

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
  return Buffer.concat([height, satoshisBuffer, scriptBuffer]);
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
  inputValuesLengthBuffer.writeUInt16BE(inputValues.length * 8);

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

Encoding.prototype.encodeBlockTimestampKey = function(hash) {
  return Buffer.concat([this.servicePrefix, new Buffer(hash, 'hex')]);
};

Encoding.prototype.decodeBlockTimestampKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeBlockTimestampValue = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return timestampBuffer;
};

Encoding.prototype.decodeBlockTimestampValue = function(buffer) {
  return buffer.readDoubleBE(0);
};

Encoding.prototype.encodeTimestampBlockKey = function(timestamp) {
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(timestamp);
  return Buffer.concat([this.servicePrefix, timestampBuffer]);
};

Encoding.prototype.decodeTimestampBlockKey = function(buffer) {
  return buffer.readDoubleBE(2);
};

Encoding.prototype.encodeTimestampBlockValue = function(hash) {
  return new Buffer(hash, 'hex');
};

Encoding.prototype.decodeTimestampBlockValue = function(buffer) {
  return buffer.toString('hex');
};

Encoding.prototype.encodeWalletTransactionKey = function(walletId, height) {
  var buffers = [this.servicePrefix];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

  if(height !== undefined) {
    var heightBuffer = new Buffer(4);
    heightBuffer.writeUInt32BE(height);
    buffers.push(heightBuffer);
  }

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeWalletTransactionKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(1);

  var walletSize = reader.readUInt8();
  var walletId = reader.read(walletSize).toString('utf8');
  var height = reader.readUInt32BE();
  var blockIndex = reader.readUInt32BE();

  return {
    walletId: walletId,
    height: height,
    blockIndex: blockIndex
  };
};

Encoding.prototype.encodeWalletTransactionValue = function(txid) {
  return new Buffer(txid, 'hex');
};

Encoding.prototype.decodeWalletTransactionValue = function(buffer) {
  return buffer.toString('hex');
};

Encoding.prototype.encodeWalletUtxoKey = function(walletId, txid, outputIndex) {
  var buffers = [this.servicePrefix];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

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

Encoding.prototype.decodeWalletUtxoKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(1);

  var walletIdSize = reader.readUInt8();
  var walletId = reader.read(walletIdSize).toString('utf8');
  var txid = reader.read(32).toString('hex');
  var outputIndex = reader.readUInt32BE();
  return {
    walletId: walletId,
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeWalletUtxoValue = function(height, satoshis, scriptBuffer) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([height, satoshisBuffer, scriptBuffer]);
};

Encoding.prototype.decodeWalletUtxoValue = function(buffer) {
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

Encoding.prototype.encodeWalletUtxoSatoshisKey = function(walletId, satoshis, txid, outputIndex) {
  var buffers = [this.servicePrefix];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

  if(satoshis !== undefined) {
    var satoshisBuffer = new Buffer(8);
    satoshisBuffer.writeUInt32BE(satoshis);
    buffers.push(satoshisBuffer);
  }

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

Encoding.prototype.decodeWalletUtxoSatoshisKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(1);

  var walletIdSizeBuffer = reader.readUInt8();
  var walletId = reader.read(walletIdSizeBuffer).toString('utf8');
  var satoshis = reader.readDoubleBE();
  var txid = reader.read(32).toString('hex');
  var outputIndex = reader.readUInt32BE();
  return {
    walletId: walletId,
    satoshis: satoshis,
    txid: txid,
    outputIndex: outputIndex
  };
};

Encoding.prototype.encodeWalletUtxoSatoshisValue = function(height, scriptBuffer) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  return Buffer.concat([height, scriptBuffer]);
};

Encoding.prototype.decodeWalletUtxoSatoshisValue = function(buffer) {
  var reader = new BufferReader(buffer);
  var height = reader.readUInt32BE();
  var scriptBuffer = reader.read(buffer.length - 4);
  return {
    height: height,
    script: scriptBuffer
  };
};

Encoding.prototype.encodeWalletAddressesKey = function(walletId) {
  var prefix = new Buffer('00', 'hex');
  var walletIdBuffer = new Buffer(walletId, 'hex');
  return Buffer.concat([this.servicePrefix, prefix, walletIdBuffer]);
};

Encoding.prototype.decodeWalletAddressesKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeWalletAddressesValue = function(addresses) {
  var bufferList = [];
  var addressesLengthBuffer = new Buffer(4);
  addressesLengthBuffer.writeUInt32BE(addresses.length);
  bufferList.push(addressesLengthBuffer);
  for(var i = 0; i < addresses.length; i++) {
    var addressSizeBuffer = new Buffer(1);
    addressSizeBuffer.writeUInt8(addresses[i].length);
    bufferList.push(addressSizeBuffer);
    bufferList.push(new Buffer(addresses[i], 'utf8'));
  }

  return Buffer.concat(bufferList);
};

Encoding.prototype.decodeWalletAddressesValue = function(buffer) {
  var reader = new BufferReader(buffer);
  var addressesLength = reader.readUInt32BE();
  var addresses = [];
  var addressSize = 0;
  for(var i = 0; i < addressesLength.length; i++) {
    addressSize = reader.readUInt8(addressSize);
    addresses.push(reader.read(addressSize).toString('utf8'));
  }

  return addresses;
};

Encoding.prototype.encodeWalletBalanceKey = function(walletId) {
  var prefix = new Buffer('01', 'hex');
  var walletIdBuffer = new Buffer(walletId, 'hex');
  return Buffer.concat([this.servicePrefix, prefix, walletIdBuffer]);
};

Encoding.prototype.decodeWalletBalanceKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeWalletBalanceValue = function(balance) {
  var balanceBuffer = new Buffer(8);
  balanceBuffer.writeUInt32BE(balance);
  return balanceBuffer;
};

Encoding.prototype.decodeWalletBalanceValue = function(buffer) {
  var reader = new BufferReader(buffer);
  var balance = reader.readDoubleBE();

  return balance;
};

module.exports = Encoding;
