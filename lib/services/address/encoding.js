'use strict';

var bitcore = require('bitcore-lib');
var BufferReader = bitcore.encoding.BufferReader;
var Address = bitcore.Address;
var PublicKey = bitcore.PublicKey;
var constants = require('./constants');
var $ = bitcore.util.preconditions;

var exports = {};

function Encoding(prefix) {
  this.prefix = prefix;
}

Encoding.prototype.getTerminalKey = function(startKey) {
  var endKey = Buffer.from(startKey);
  endKey.writeUInt8(startKey.readUInt8(startKey.length - 1) + 1, startKey.length - 1);
  return endKey;
};

Encoding.prototype.encodeAddressIndexKey = function(address, isSpent, height, txid, index, spending) {
  // TODO if later params are given but not earlier ones, throw an error
  var buffers = [this.prefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  if(isSpent !== undefined) {
    var isSpentBuffer = new Buffer(1);
    isSpentBuffer.writeUInt8(isSpent);
    buffers.push(isSpentBuffer);
  }

  if(height !== undefined) {
    var heightBuffer = new Buffer(4);
    heightBuffer.writeUInt32BE(height);
    buffers.push(heightBuffer);
  }

  if(txid) {
    var txidBuffer = new Buffer(txid, 'hex');
    buffers.push(txidBuffer);
  }

  if(index !== undefined) {
    var indexBuffer = new Buffer(4);
    indexBuffer.writeUInt32BE(index);
    buffers.push(indexBuffer);
  }

  if(spending !== undefined) {
    var spendingBuffer = new Buffer(1);
    spendingBuffer.writeUInt8(spending);
    buffers.push(spendingBuffer);
  }

  return Buffer.concat(buffers);
};

Encoding.prototype.decodeAddressIndexKey = function(buffer) {
  var reader = new BufferReader(buffer);
  var prefix = reader.read(2);

  var addressSize = reader.readUInt8();
  var address = reader.read(addressSize).toString('utf8');
  var isSpent = reader.readUInt8();
  var height = reader.readUInt32BE();
  var txid = reader.read(32).toString('hex');
  var index = reader.readUInt32BE();
  var spending = reader.readUInt8();
  return {
    address: address,
    isSpent: isSpent ? true : false,
    height: height,
    txid: txid,
    index: index,
    spending: spending ? true : false
  };
};

Encoding.prototype.encodeAddressIndexValue = function(satoshis, scriptBuffer) {
  var satoshisBuffer = new Buffer(8);
  satoshisBuffer.writeDoubleBE(satoshis);
  return Buffer.concat([satoshisBuffer, scriptBuffer]);
};

Encoding.prototype.decodeAddressIndexValue = function(buffer) {
  var satoshis = buffer.readDoubleBE(0);
  var scriptBuffer = buffer.slice(8, buffer.length);
  return {
    satoshis: satoshis,
    script: scriptBuffer
  };
};

// exports.encodeUnspentIndexKey = function(hashTypeBuffer, hashBuffer, txid, index) {
//   var indexBuffer = new Buffer(4);
//   indexBuffer.writeUInt32BE(index);
//   var txidBuffer = new Buffer(txid, 'hex');

//   var key = Buffer.concat([
//     constants.PREFIXES.UNSPENT,
//     hashTypeBuffer,
//     hashBuffer,
//     constants.SPACER_MIN,
//     txidBuffer,
//     indexBuffer
//   ]);
// };

// exports.decodeUnspentIndexKey = function(buffer) {
//   var reader = new BufferReader(buffer);
//   var prefix = reader.read(1);
//   var hashTypeBuffer = reader.read(1);
//   var hashBuffer = reader.read(20);

//   var spacer = reader.read(1);
//   var txid = reader.read(32);
//   var index = reader.readUInt32BE();
//   return {
//     prefix: prefix,
//     hashTypeBuffer: hashTypeBuffer,
//     hashBuffer: hashBuffer,
//     txid: txid,
//     index: outputIndex
//   };
// };

// exports.encodeUnspentIndexValue = function(satoshis, height, scriptBuffer) {
//   var satoshisBuffer = new Buffer(8);
//   satoshisBuffer.writeDoubleBE(satoshis);

//   var heightBuffer = new Buffer(4);
//   heightBuffer.writeUInt32BE(height);

//   return Buffer.concat([satoshisBuffer, heightBuffer, scriptBuffer]);
// };

// exports.decodeUnspentIndexValue = function(buffer) {
//   var satoshis = buffer.readDoubleBE(0);
//   var height = buffer.readUInt32BE(8);
//   var scriptBuffer = buffer.slice(12, buffer.length);

//   return {
//     satoshis: satoshis,
//     height: height,
//     scriptBuffer: scriptBuffer
//   };
// };


// exports.encodeSpentIndexSyncKey = function(txidBuffer, outputIndex) {
//   var outputIndexBuffer = new Buffer(4);
//   outputIndexBuffer.writeUInt32BE(outputIndex);
//   var key = Buffer.concat([
//     txidBuffer,
//     outputIndexBuffer
//   ]);
//   return key.toString('binary');
// };

// exports.encodeMempoolAddressIndexKey = function(hashBuffer, hashTypeBuffer) {
//   var key = Buffer.concat([
//     hashBuffer,
//     hashTypeBuffer,
//   ]);
//   return key.toString('binary');
// };


// exports.encodeOutputKey = function(hashBuffer, hashTypeBuffer, height, txidBuffer, outputIndex) {
//   var heightBuffer = new Buffer(4);
//   heightBuffer.writeUInt32BE(height);
//   var outputIndexBuffer = new Buffer(4);
//   outputIndexBuffer.writeUInt32BE(outputIndex);
//   var key = Buffer.concat([
//     constants.PREFIXES.OUTPUTS,
//     hashBuffer,
//     hashTypeBuffer,
//     constants.SPACER_MIN,
//     heightBuffer,
//     txidBuffer,
//     outputIndexBuffer
//   ]);
//   return key;
// };

// exports.decodeOutputKey = function(buffer) {
//   var reader = new BufferReader(buffer);
//   var prefix = reader.read(1);
//   var hashBuffer = reader.read(20);
//   var hashTypeBuffer = reader.read(1);
//   var spacer = reader.read(1);
//   var height = reader.readUInt32BE();
//   var txid = reader.read(32);
//   var outputIndex = reader.readUInt32BE();
//   return {
//     prefix: prefix,
//     hashBuffer: hashBuffer,
//     hashTypeBuffer: hashTypeBuffer,
//     height: height,
//     txid: txid,
//     outputIndex: outputIndex
//   };
// };

// exports.encodeOutputValue = function(satoshis, scriptBuffer) {
//   var satoshisBuffer = new Buffer(8);
//   satoshisBuffer.writeDoubleBE(satoshis);
//   return Buffer.concat([satoshisBuffer, scriptBuffer]);
// };

// exports.encodeOutputMempoolValue = function(satoshis, timestampBuffer, scriptBuffer) {
//   var satoshisBuffer = new Buffer(8);
//   satoshisBuffer.writeDoubleBE(satoshis);
//   return Buffer.concat([satoshisBuffer, timestampBuffer, scriptBuffer]);
// };

// exports.decodeOutputValue = function(buffer) {
//   var satoshis = buffer.readDoubleBE(0);
//   var scriptBuffer = buffer.slice(8, buffer.length);
//   return {
//     satoshis: satoshis,
//     scriptBuffer: scriptBuffer
//   };
// };

// exports.decodeOutputMempoolValue = function(buffer) {
//   var satoshis = buffer.readDoubleBE(0);
//   var timestamp = buffer.readDoubleBE(8);
//   var scriptBuffer = buffer.slice(16, buffer.length);
//   return {
//     satoshis: satoshis,
//     timestamp: timestamp,
//     scriptBuffer: scriptBuffer
//   };
// };

// exports.encodeInputKey = function(hashBuffer, hashTypeBuffer, height, prevTxIdBuffer, outputIndex) {
//   var heightBuffer = new Buffer(4);
//   heightBuffer.writeUInt32BE(height);
//   var outputIndexBuffer = new Buffer(4);
//   outputIndexBuffer.writeUInt32BE(outputIndex);
//   return Buffer.concat([
//     constants.PREFIXES.SPENTS,
//     hashBuffer,
//     hashTypeBuffer,
//     constants.SPACER_MIN,
//     heightBuffer,
//     prevTxIdBuffer,
//     outputIndexBuffer
//   ]);
// };

// exports.decodeInputKey = function(buffer) {
//   var reader = new BufferReader(buffer);
//   var prefix = reader.read(1);
//   var hashBuffer = reader.read(20);
//   var hashTypeBuffer = reader.read(1);
//   var spacer = reader.read(1);
//   var height = reader.readUInt32BE();
//   var prevTxId = reader.read(32);
//   var outputIndex = reader.readUInt32BE();
//   return {
//     prefix: prefix,
//     hashBuffer: hashBuffer,
//     hashTypeBuffer: hashTypeBuffer,
//     height: height,
//     prevTxId: prevTxId,
//     outputIndex: outputIndex
//   };
// };

// exports.encodeInputValue = function(txidBuffer, inputIndex) {
//   var inputIndexBuffer = new Buffer(4);
//   inputIndexBuffer.writeUInt32BE(inputIndex);
//   return Buffer.concat([
//     txidBuffer,
//     inputIndexBuffer
//   ]);
// };

// exports.decodeInputValue = function(buffer) {
//   var txid = buffer.slice(0, 32);
//   var inputIndex = buffer.readUInt32BE(32);
//   return {
//     txid: txid,
//     inputIndex: inputIndex
//   };
// };

// exports.encodeInputKeyMap = function(outputTxIdBuffer, outputIndex) {
//   var outputIndexBuffer = new Buffer(4);
//   outputIndexBuffer.writeUInt32BE(outputIndex);
//   return Buffer.concat([
//     constants.PREFIXES.SPENTSMAP,
//     outputTxIdBuffer,
//     outputIndexBuffer
//   ]);
// };

// exports.decodeInputKeyMap = function(buffer) {
//   var txid = buffer.slice(1, 33);
//   var outputIndex = buffer.readUInt32BE(33);
//   return {
//     outputTxId: txid,
//     outputIndex: outputIndex
//   };
// };

// exports.encodeInputValueMap = function(inputTxIdBuffer, inputIndex) {
//   var inputIndexBuffer = new Buffer(4);
//   inputIndexBuffer.writeUInt32BE(inputIndex);
//   return Buffer.concat([
//     inputTxIdBuffer,
//     inputIndexBuffer
//   ]);
// };

// exports.decodeInputValueMap = function(buffer) {
//   var txid = buffer.slice(0, 32);
//   var inputIndex = buffer.readUInt32BE(32);
//   return {
//     inputTxId: txid,
//     inputIndex: inputIndex
//   };
// };

// exports.encodeSummaryCacheKey = function(address) {
//   return Buffer.concat([address.hashBuffer, constants.HASH_TYPES_MAP[address.type]]);
// };

// exports.decodeSummaryCacheKey = function(buffer, network) {
//   var hashBuffer = buffer.read(20);
//   var type = constants.HASH_TYPES_READABLE[buffer.read(20, 2).toString('hex')];
//   var address = new Address({
//     hashBuffer: hashBuffer,
//     type: type,
//     network: network
//   });
//   return address;
// };

// exports.encodeSummaryCacheValue = function(cache, tipHeight, tipHash) {
//   var tipHashBuffer = new Buffer(tipHash, 'hex');
//   var buffer = new Buffer(new Array(20));
//   buffer.writeUInt32BE(tipHeight);
//   buffer.writeDoubleBE(cache.result.totalReceived, 4);
//   buffer.writeDoubleBE(cache.result.balance, 12);
//   var txidBuffers = [];
//   for (var i = 0; i < cache.result.txids.length; i++) {
//     var buf = new Buffer(new Array(36));
//     var txid = cache.result.txids[i];
//     buf.write(txid, 'hex');
//     buf.writeUInt32BE(cache.result.appearanceIds[txid], 32);
//     txidBuffers.push(buf);
//   }
//   var txidsBuffer = Buffer.concat(txidBuffers);
//   var value = Buffer.concat([tipHashBuffer, buffer, txidsBuffer]);

//   return value;
// };

// exports.decodeSummaryCacheValue = function(buffer) {

//   var hash = buffer.slice(0, 32).toString('hex');
//   var height = buffer.readUInt32BE(32);
//   var totalReceived = buffer.readDoubleBE(36);
//   var balance = buffer.readDoubleBE(44);

//   // read 32 byte chunks until exhausted
//   var appearanceIds = {};
//   var txids = [];
//   var pos = 52;
//   while(pos < buffer.length) {
//     var txid = buffer.slice(pos, pos + 32).toString('hex');
//     var txidHeight = buffer.readUInt32BE(pos + 32);
//     txids.push(txid);
//     appearanceIds[txid] = txidHeight;
//     pos += 36;
//   }

//   var cache = {
//     height: height,
//     hash: hash,
//     result: {
//       appearanceIds: appearanceIds,
//       txids: txids,
//       totalReceived: totalReceived,
//       balance: balance,
//       unconfirmedAppearanceIds: {}, // unconfirmed values are never stored in cache
//       unconfirmedBalance: 0
//     }
//   };

//   return cache;
// };

// exports.getAddressInfo = function(addressStr) {
//   var addrObj = bitcore.Address(addressStr);
//   var hashTypeBuffer = constants.HASH_TYPES_MAP[addrObj.type];

//   return {
//     hashBuffer: addrObj.hashBuffer,
//     hashTypeBuffer: hashTypeBuffer,
//     hashTypeReadable: addrObj.type
//   };
// };

// /**
//  * This function is optimized to return address information about an output script
//  * without constructing a Bitcore Address instance.
//  * @param {Script} - An instance of a Bitcore Script
//  * @param {Network|String} - The network for the address
//  */
// exports.extractAddressInfoFromScript = function(script, network) {
//   $.checkArgument(network, 'Second argument is expected to be a network');
//   var hashBuffer;
//   var addressType;
//   var hashTypeBuffer;
//   if (script.isPublicKeyHashOut()) {
//     hashBuffer = script.chunks[2].buf;
//     hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
//     addressType = Address.PayToPublicKeyHash;
//   } else if (script.isScriptHashOut()) {
//     hashBuffer = script.chunks[1].buf;
//     hashTypeBuffer = constants.HASH_TYPES.REDEEMSCRIPT;
//     addressType = Address.PayToScriptHash;
//   } else if (script.isPublicKeyOut()) {
//     var pubkey = script.chunks[0].buf;
//     var address = Address.fromPublicKey(new PublicKey(pubkey), network);
//     hashBuffer = address.hashBuffer;
//     hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
//     // pay-to-publickey doesn't have an address, however for compatibility
//     // purposes, we can create an address
//     addressType = Address.PayToPublicKeyHash;
//   } else {
//     return false;
//   }
//   return {
//     hashBuffer: hashBuffer,
//     hashTypeBuffer: hashTypeBuffer,
//     addressType: addressType
//   };
// };

module.exports = Encoding;
