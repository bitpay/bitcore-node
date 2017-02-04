'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this._subKeyMap = {
    transaction: new Buffer('00', 'hex'),
    addresses: new Buffer('01', 'hex'),
    utxo: new Buffer('02', 'hex'),
    utxoSat: new Buffer('03', 'hex'),
    balance: new Buffer('04', 'hex')
  };
}

Encoding.prototype.encodeWalletTransactionKey = function(walletId, height) {
  var buffers = [this.servicePrefix, this._subKeyMap.transaction];

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
  reader.read(3);

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
  var buffers = [this.servicePrefix, this._subKeyMap.utxo];

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
  return Buffer.concat([height, satoshisBuffer, scriptBuffer]);
};

Encoding.prototype.decodeWalletUtxoValue = function(buffer) {
  var reader = new BufferReader(buffer);
  var height = reader.readUInt32BE();
  var satoshis = buffer.readDoubleBE(4);
  var scriptBuffer = reader.read(12, buffer.length - 12);
  return {
    height: height,
    satoshis: satoshis,
    script: scriptBuffer
  };
};

Encoding.prototype.encodeWalletUtxoSatoshisKey = function(walletId, satoshis, txid, outputIndex) {
  var buffers = [this.servicePrefix, this._subKeyMap.utxoSat];

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
  reader.read(3);

  var walletIdSize = reader.readUInt8();
  var walletId = reader.read(walletIdSize).toString('utf8');
  var satoshis = buffer.readDoubleBE(walletIdSize + 4);
  var txid = reader.read(walletIdSize + 12, 32).toString('hex');
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
  var prefix = this._subKeyMap.addresses;
  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');
  return Buffer.concat([this.servicePrefix, prefix, walletIdSizeBuffer, walletIdBuffer]);
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
  for(var i = 0; i < addressesLength; i++) {
    var addressSize = reader.readUInt8();
    addresses.push(reader.read(addressSize).toString('utf8'));
  }
  return addresses;
};

Encoding.prototype.encodeWalletBalanceKey = function(walletId) {
  var prefix = this._subKeyMap.balance;
  var walletIdSizeBuffer = new Buffer(1);
  walletIdSizeBuffer.writeUInt8(walletId.length);
  var walletIdBuffer = new Buffer(walletId, 'utf8');
  return Buffer.concat([this.servicePrefix, prefix, walletIdSizeBuffer, walletIdBuffer]);
};

Encoding.prototype.decodeWalletBalanceKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeWalletBalanceValue = function(balance) {
  var balanceBuffer = new Buffer(8);
  balanceBuffer.writeDoubleBE(balance);
  return balanceBuffer;
};

Encoding.prototype.decodeWalletBalanceValue = function(buffer) {
  var balance = buffer.readDoubleBE();
  return balance;
};

module.exports = Encoding;

