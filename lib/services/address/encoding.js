'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;
var Address = bitcore.Address;
var PublicKey = bitcore.PublicKey;
var constants = require('./constants');
var $ = bitcore.util.preconditions;

var exports = {};

exports.encodeSpentIndexSyncKey = function(txidBuffer, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var key = Buffer.concat([
    txidBuffer,
    outputIndexBuffer
  ]);
  return key.toString('binary');
};

exports.encodeOutputKey = function(hashBuffer, hashTypeBuffer, height, txidBuffer, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var key = Buffer.concat([
    constants.PREFIXES.OUTPUTS,
    hashBuffer,
    hashTypeBuffer,
    constants.SPACER_MIN,
    heightBuffer,
    txidBuffer,
    outputIndexBuffer
  ]);
  return key;
};

exports.decodeOutputKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(1);
  var hashBuffer = reader.read(20);
  var hashTypeBuffer = reader.read(1);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var txid = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    height: height,
    txid: txid,
    outputIndex: outputIndex
  };
};

exports.encodeOutputValue = function(satoshis, scriptBuffer) {
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([satoshisBuffer, scriptBuffer]);
};

exports.decodeOutputValue = function(buffer) {
  var satoshis = buffer.readDoubleBE(0);
  var scriptBuffer = buffer.slice(8, buffer.length);
  return {
    satoshis: satoshis,
    scriptBuffer: scriptBuffer
  };
};

exports.encodeInputKey = function(hashBuffer, hashTypeBuffer, height, prevTxIdBuffer, outputIndex) {
  var heightBuffer = new Buffer(4);
  heightBuffer.writeUInt32BE(height);
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([
    constants.PREFIXES.SPENTS,
    hashBuffer,
    hashTypeBuffer,
    constants.SPACER_MIN,
    heightBuffer,
    prevTxIdBuffer,
    outputIndexBuffer
  ]);
};

exports.decodeInputKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(1);
  var hashBuffer = reader.read(20);
  var hashTypeBuffer = reader.read(1);
  var spacer = reader.read(1);
  var height = reader.readUInt32BE();
  var prevTxId = reader.read(32);
  var outputIndex = reader.readUInt32BE();
  return {
    prefix: prefix,
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    height: height,
    prevTxId: prevTxId,
    outputIndex: outputIndex
  };
};

exports.encodeInputValue = function(txidBuffer, inputIndex) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  return Buffer.concat([
    txidBuffer,
    inputIndexBuffer
  ]);
};

exports.decodeInputValue = function(buffer) {
  var txid = buffer.slice(0, 32);
  var inputIndex = buffer.readUInt32BE(32);
  return {
    txid: txid,
    inputIndex: inputIndex
  };
};

exports.encodeInputKeyMap = function(outputTxIdBuffer, outputIndex) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  return Buffer.concat([
    constants.PREFIXES.SPENTSMAP,
    outputTxIdBuffer,
    outputIndexBuffer
  ]);
};

exports.decodeInputKeyMap = function(buffer) {
  var txid = buffer.slice(1, 33);
  var outputIndex = buffer.readUInt32BE(33);
  return {
    outputTxId: txid,
    outputIndex: outputIndex
  };
};

exports.encodeInputValueMap = function(inputTxIdBuffer, inputIndex) {
  var inputIndexBuffer = new Buffer(4);
  inputIndexBuffer.writeUInt32BE(inputIndex);
  return Buffer.concat([
    inputTxIdBuffer,
    inputIndexBuffer
  ]);
};

exports.decodeInputValueMap = function(buffer) {
  var txid = buffer.slice(0, 32);
  var inputIndex = buffer.readUInt32BE(32);
  return {
    inputTxId: txid,
    inputIndex: inputIndex
  };
};

exports.encodeSummaryCacheKey = function(address) {
  return Buffer.concat([address.hashBuffer, constants.HASH_TYPES_BUFFER[address.type]]);
};

exports.decodeSummaryCacheKey = function(buffer, network) {
  var hashBuffer = buffer.read(20);
  var type = constants.HASH_TYPES_READABLE[buffer.read(20, 2).toString('hex')];
  var address = new Address({
    hashBuffer: hashBuffer,
    type: type,
    network: network
  });
  return address;
};

exports.encodeSummaryCacheValue = function(cache, tipHeight) {
  var buffer = new Buffer(new Array(20));
  buffer.writeUInt32BE(tipHeight);
  buffer.writeDoubleBE(cache.result.totalReceived, 4);
  buffer.writeDoubleBE(cache.result.balance, 12);
  var txidBuffers = [];
  for (var key in cache.result.appearanceIds) {
    txidBuffers.push(new Buffer(key, 'hex'));
  }
  var txidsBuffer = Buffer.concat(txidBuffers);
  var value = Buffer.concat([buffer, txidsBuffer]);

  return value;
};

exports.decodeSummaryCacheValue = function(buffer) {

  var height = buffer.readUInt32BE();
  var totalReceived = buffer.readDoubleBE(4);
  var balance = buffer.readDoubleBE(12);

  // read 32 byte chunks until exhausted
  var appearanceIds = {};
  var pos = 16;
  while(pos < buffer.length) {
    var txid = buffer.slice(pos, pos + 32).toString('hex');
    appearanceIds[txid] = true;
    pos += 32;
  }

  var cache = {
    height: height,
    result: {
      appearanceIds: appearanceIds,
      totalReceived: totalReceived,
      balance: balance,
      unconfirmedAppearanceIds: {}, // unconfirmed values are never stored in cache
      unconfirmedBalance: 0
    }
  };

  return cache;
};

exports.getAddressInfo = function(addressStr) {
  var addrObj = bitcore.Address(addressStr);
  var hashTypeBuffer = constants.HASH_TYPES_MAP[addrObj.type];
  
  return {
    hashBuffer: addrObj.hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    hashTypeReadable: addrObj.type
  };
};

/**
 * This function is optimized to return address information about an output script
 * without constructing a Bitcore Address instance.
 * @param {Script} - An instance of a Bitcore Script
 * @param {Network|String} - The network for the address
 */
exports.extractAddressInfoFromScript = function(script, network) {
  $.checkArgument(network, 'Second argument is expected to be a network');
  var hashBuffer;
  var addressType;
  var hashTypeBuffer;
  if (script.isPublicKeyHashOut()) {
    hashBuffer = script.chunks[2].buf;
    hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    addressType = Address.PayToPublicKeyHash;
  } else if (script.isScriptHashOut()) {
    hashBuffer = script.chunks[1].buf;
    hashTypeBuffer = constants.HASH_TYPES.REDEEMSCRIPT;
    addressType = Address.PayToScriptHash;
  } else if (script.isPublicKeyOut()) {
    var pubkey = script.chunks[0].buf;
    var address = Address.fromPublicKey(new PublicKey(pubkey), network);
    hashBuffer = address.hashBuffer;
    hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    // pay-to-publickey doesn't have an address, however for compatibility
    // purposes, we can create an address
    addressType = Address.PayToPublicKeyHash;
  } else {
    return false;
  }
  return {
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    addressType: addressType
  };
};

module.exports = exports;
