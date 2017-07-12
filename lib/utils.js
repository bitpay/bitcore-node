'use strict';

var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var MAX_SAFE_INTEGER = 0x1fffffffffffff; // 2 ^ 53 - 1
var crypto = require('crypto');
var _ = require('lodash');

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

utils.getAddressString = function(opts) {

  if (!opts.item || !opts.item.script) {
    return;
  }

  if (opts.tx && opts.tx.isCoinbase()) {
    return;
  }

  var address = opts.item.script.toAddress(opts.network || 'livenet');

  if(address) {
    return address.toString();
  }


  try {
    var pubkey = opts.item.script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {}

};

utils.sendError = function(err, res) {
  if (err.statusCode)  {
    res.status(err.statusCode).send(err.message);
  } else {
    console.error(err.stack);
    res.status(503).send(err.message);
  }
};

utils.getWalletId = exports.generateJobId = function() {
  return crypto.randomBytes(16).toString('hex');
};

utils.getWalletId = exports.generateJobId = function() {
  return crypto.randomBytes(16).toString('hex');
};

utils.toJSONL = function(obj) {
  var str = JSON.stringify(obj);
  str = str.replace(/\n/g, '');
  return str + '\n';
};

utils.normalizeTimeStamp = function(addressArg) {
  var addresses = [addressArg];
  if (Array.isArray(addressArg)) {
    addresses = addressArg;
  }
  return addresses;
};

utils.normalizeTimeStamp = function(value) {
  if (value > 0xffffffff) {
    value = Math.round(value/1000);
  }
  return value;
};

utils.delimitedStringParse = function(delim, str) {
  function tryJSONparse(str) {
    try {
      return JSON.parse(str);
    } catch(e) {
      return false;
    }
  }
  var ret = [];

  if (delim === null) {
    return tryJSONparse(str);
  }

  var list = str.split(delim);
  for(var i = 0; i < list.length; i++) {
    ret.push(tryJSONparse(list[i]));
  }
  ret = _.compact(ret);
  return ret.length === 0 ? false : ret;

};

utils.toIntIfNumberLike = function(a) {
  if (!/[^\d]+/.test(a)) {
    return parseInt(a);
  }
  return a;
};

utils.getAddressString = function(script, output) {
  var address = script.toAddress(this.node.network.name);
  if(address) {
    return address.toString();
  }

  try {
    var pubkey = script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {
  }

  //TODO add back in P2PK, but for this we need to look up the utxo for this script
  if(output && output.script && output.script.isPublicKeyOut()) {
    return output.script.getPublicKey().toString('hex');
  }

  return null;
};

utils.getBlockInfoString = function(tip, best) {

  var diff = best - tip;
  var astr = diff + ' blocks behind.';

  if (diff === -1) {
    astr = Math.abs(diff) + ' block ahead. Peer may be syncing or we may need to reorganize our chain after new blocks arrive.';
  } else if (diff < 1) {
    astr = Math.abs(diff) + ' blocks ahead. Peer may be syncing or we may need to reorganize our chain after new blocks arrive.';
  } else if (diff === 1) {
    astr = diff + ' block behind.';
  }

};

module.exports = utils;
