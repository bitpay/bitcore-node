'use strict';

var exports = {};

exports.PREFIXES = {
  OUTPUTS: new Buffer('02', 'hex'), // Query outputs by address and/or height
  SPENTS: new Buffer('03', 'hex'), // Query inputs by address and/or height
  SPENTSMAP: new Buffer('05', 'hex') // Get the input that spends an output
};

exports.MEMPREFIXES = {
  OUTPUTS: new Buffer('01', 'hex'), // Query mempool outputs by address
  SPENTS: new Buffer('02', 'hex'), // Query mempool inputs by address
  SPENTSMAP: new Buffer('03', 'hex') // Query mempool for the input that spends an output
};

// To save space, we're only storing the PubKeyHash or ScriptHash in our index.
// To avoid intentional unspendable collisions, which have been seen on the blockchain,
// we must store the hash type (PK or Script) as well.
exports.HASH_TYPES = {
  PUBKEY: new Buffer('01', 'hex'),
  REDEEMSCRIPT: new Buffer('02', 'hex')
};

// Translates from our enum type back into the hash types returned by
// bitcore-lib/address.
exports.HASH_TYPES_READABLE = {
  '01': 'pubkeyhash',
  '02': 'scripthash'
};

exports.HASH_TYPES_MAP = {
  'pubkeyhash': exports.HASH_TYPES.PUBKEY,
  'scripthash': exports.HASH_TYPES.REDEEMSCRIPT
};

exports.SPACER_MIN = new Buffer('00', 'hex');
exports.SPACER_MAX = new Buffer('ff', 'hex');

// The total number of transactions that an address can receive before it will start
// to cache the summary to disk.
exports.SUMMARY_CACHE_THRESHOLD = 10000;


// The default maximum length queries
exports.MAX_INPUTS_QUERY_LENGTH = 50000;
exports.MAX_OUTPUTS_QUERY_LENGTH = 50000;
exports.MAX_HISTORY_QUERY_LENGTH = 1000;

module.exports = exports;

