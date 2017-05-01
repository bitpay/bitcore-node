'use strict';

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

/*
 * input: arguments passed into originating function (whoever called us)
 * output: bool args are valid for encoding a key to the database
*/
utils.hasRequiredArgsForEncoding = function(args) {
  function exists(arg) {
    return !(arg === null || arg === undefined);
  }

  if (!exists(args[0])) {
    return false;
  }

  var pastArgMissing;

  for(var i = 1; i < args.length; i++) {
    var argMissing = exists(args[i]);
    if (argMissing && pastArgMissing) {
      return false;
    }
    pastArgMissing = argMissing;
  }

  return true;
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

module.exports = utils;
