'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.subKeyMap = {
    transaction: {
      fn: this.encodeWalletTransactionKey,
      buffer: new Buffer('00', 'hex')
    },
    addresses: {
      fn: this.encodeWalletAddressesKey,
      buffer: new Buffer('01', 'hex')
    },
    utxo: {
      fn: this.encodeWalletUtxoKey,
      buffer: new Buffer('02', 'hex')
    },
    utxoSat: {
      fn: this.encodeWalletUtxoSatoshisKey,
      buffer: new Buffer('03', 'hex')
    },
    balance: {
      fn: this.encodeWalletBalanceKey,
      buffer: new Buffer('04', 'hex')
    }
  };
}

Encoding.prototype.encodeWalletTransactionKey = function(walletId, height) {
  var buffers = [this.servicePrefix, this.subKeyMap.transaction.buffer];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height || 0);
  buffers.push(heightBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeWalletTransactionKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

  var walletSize = reader.readUInt8();
  var walletId = reader.read(walletSize).toString('utf8');
  var height = reader.readUInt32BE();

  return {
    walletId: walletId,
    height: height
  };
};

Encoding.prototype.encodeWalletTransactionValue = function(txid) {
  return new Buffer(txid, 'hex');
};

Encoding.prototype.decodeWalletTransactionValue = function(buffer) {
  return buffer.toString('hex');
};

Encoding.prototype.encodeWalletUtxoKey = function(walletId, txid, outputIndex) {
  var buffers = [this.servicePrefix, this.subKeyMap.utxo.buffer];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

  var txidBuffer = new Buffer(txid || new Array(33).join('0'), 'hex');
  buffers.push(txidBuffer);

  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex || 0);
  buffers.push(outputIndexBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeWalletUtxoKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);

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
  return Buffer.concat([heightBuffer, satoshisBuffer, scriptBuffer]);
};

Encoding.prototype.decodeWalletUtxoValue = function(buffer) {
  var reader = new BufferReader(buffer);
  var height = reader.readUInt32BE();
  var satoshis = buffer.readDoubleBE(4);
  var scriptBuffer = buffer.slice(12);
  return {
    height: height,
    satoshis: satoshis,
    script: scriptBuffer
  };
};

Encoding.prototype.encodeWalletUtxoSatoshisKey = function(walletId, satoshis, txid, outputIndex) {
  var buffers = [this.servicePrefix, this.subKeyMap.utxoSat.buffer];

  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');

  buffers.push(walletIdSizeBuffer);
  buffers.push(walletIdBuffer);

  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis || 0);
  buffers.push(satoshisBuffer);

  var txidBuffer = new Buffer(txid || new Array(33).join('0'), 'hex');
  buffers.push(txidBuffer);

  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex || 0);
  buffers.push(outputIndexBuffer);

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeWalletUtxoSatoshisKey = function(buffer) {
  var walletIdSize = buffer.readUInt8(3);
  var walletId = buffer.slice(4, walletIdSize + 4).toString('utf8');
  var satoshis = buffer.readDoubleBE(walletIdSize + 4);

  var txid = buffer.slice(walletIdSize + 12, walletIdSize + 44).toString('hex');
  var outputIndex = buffer.readUInt32BE(walletIdSize + 44);
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
  return Buffer.concat([heightBuffer, scriptBuffer]);
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
  var prefix = this.subKeyMap.addresses.buffer;
  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');
  return Buffer.concat([this.servicePrefix, prefix, walletIdSizeBuffer, walletIdBuffer]);
};

Encoding.prototype.decodeWalletAddressesKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);
  var walletSize = reader.readUInt8();
  return reader.read(walletSize).toString('utf8');
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
  for(var i = 0; i < addressesLength; i++) {
    var addressSize = reader.readUInt8();
    addresses.push(reader.read(addressSize).toString('utf8'));
  }
  return addresses;
};

Encoding.prototype.encodeWalletBalanceKey = function(walletId) {
  var prefix = this.subKeyMap.balance.buffer;
  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');
  return Buffer.concat([this.servicePrefix, prefix, walletIdSizeBuffer, walletIdBuffer]);
};

Encoding.prototype.decodeWalletBalanceKey = function(buffer) {
  var reader = new BufferReader(buffer);
  reader.read(3);
  var walletSize = reader.readUInt8();
  return reader.read(walletSize).toString('utf8');
};

Encoding.prototype.encodeWalletBalanceValue = function(balance) {
  var balanceBuffer = new Buffer(8);
  balanceBuffer.writeDoubleBE(balance);
  return balanceBuffer;
};

Encoding.prototype.decodeWalletBalanceValue = function(buffer) {
  return buffer.readDoubleBE();
};

module.exports = Encoding;

