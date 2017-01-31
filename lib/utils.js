'use strict';

var MAX_SAFE_INTEGER = 0x1fffffffffffff; // 2 ^ 53 - 1

var utils = {};
utils.isHash = function isHash(value) {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-fA-F]+$/.test(value);
};

utils.isSafeNatural = function isSafeNatural(value) {
  return typeof value === 'number' &&
    isFinite(value) &&
    Math.floor(value) === value &&
    value >= 0 &&
    value <= MAX_SAFE_INTEGER;
};

utils.startAtZero = function startAtZero(obj, key) {
  if (!obj.hasOwnProperty(key)) {
    obj[key] = 0;
  }
};

utils.isAbsolutePath = require('path').isAbsolute;
if (!utils.isAbsolutePath) {
  utils.isAbsolutePath = require('path-is-absolute');
}

utils.parseParamsWithJSON = function parseParamsWithJSON(paramsArg) {
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
* input: string representing a number + multiple of bytes, e.g. 500MB, 200KB, 100B
* output: integer representing the byte count
*/
utils.parseByteCount = function(byteCountString) {

  function finish(n, m) {
    var num = parseInt(n);
    if (num > 0) {
      return num * m;
    }
    return null;
  }

  if (!_.isString(byteCountString)) {
    return byteCountString;
  }
  var str = byteCountString.replace(/\s+/g, '');
  var map = { 'MB': 1E6, 'kB': 1000, 'KB': 1000, 'MiB': (1024 * 1024),
    'KiB': 1024, 'GiB': Math.pow(1024, 3), 'GB': 1E9 };
  var keys = Object.keys(map);
  for(var i = 0; i < keys.length; i++) {
    var re = new RegExp(keys[i] + '$');
    var match = str.match(re);
    if (match) {
      var num = str.slice(0, match.index);
      return finish(num, map[keys[i]]);
    }
  }
  return finish(byteCountString, 1);
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

module.exports = utils;
