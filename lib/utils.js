'use strict';

var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var MAX_SAFE_INTEGER = 0x1fffffffffffff; // 2 ^ 53 - 1

var utils = {};
utils.isHash = function(value) {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-fA-F]+$/.test(value);
};

utils.isSafeNatural = function(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value >= 0 &&
    value <= MAX_SAFE_INTEGER;
};

utils.startAtZero = function(obj, key) {
  if (!obj.hasOwnProperty(key)) {
    obj[key] = 0;
  }
};

utils.isAbsolutePath = require('path').isAbsolute;
if (!utils.isAbsolutePath) {
  utils.isAbsolutePath = require('path-is-absolute');
}

utils.parseParamsWithJSON = function(paramsArg) {
  var params = paramsArg.map(function(paramArg) {
    var param;
    try {
      param = JSON.parse(paramArg);
    } catch(err) {
      param = paramArg;
    }
    return param;
  });
  return params;
};

utils.getTerminalKey = function(startKey) {
  var endKey = Buffer.from(startKey);
  endKey.writeUInt8(startKey.readUInt8(startKey.length - 1) + 1, startKey.length - 1);
  return endKey;
};

utils.diffTime = function(time) {
  var diff = process.hrtime(time);
  return (diff[0] * 1E9 + diff[1])/(1E9 * 1.0);
};

utils.reverseBufferToString = function(buf) {
  return BufferUtil.reverse(buf).toString('hex');
};

//TODO: write some code here
utils.getIpAddressInfo = function(ipStr) {
  //is this ipv4 or ipv6, 4 is 32 bits, 6 is 128 bits
  //does this string have colons or periods?
};

utils.getAddressStringFromScript = function(script, network) {
  var address = script.toAddress(network);

  if(address) {
    return address.toString();
  }

  try {
    var pubkey = script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {}

};

module.exports = utils;
