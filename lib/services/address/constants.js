'use strict';

var exports = {};

exports.PREFIXES = {
  BALANCE: new Buffer('02', 'hex'), // Query the balance of an address
  UNSPENT: new Buffer('03', 'hex'), // Query unspent output positions
  SATOSHIS: new Buffer('05', 'hex'), // Query the address and satoshis for an output by txid and output index
  TXIDS: new Buffer('06', 'hex') // Query all of the txids for an address
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

exports.ADDRESS_KEY_SIZE = 21;
exports.SPACER_SIZE = 1;
exports.PREFIX_SIZE = 1;
exports.HEIGHT_SIZE = 4;
exports.TXID_SIZE = 32;
exports.PAGE_SIZE = 10;

exports.HASH_TYPES_MAP = {
  'pubkeyhash': exports.HASH_TYPES.PUBKEY,
  'scripthash': exports.HASH_TYPES.REDEEMSCRIPT
};

exports.SPACER_MIN = new Buffer('00', 'hex');
exports.SPACER_MAX = new Buffer('ff', 'hex');
exports.SPACER_HEIGHT_MIN = new Buffer('0000000000', 'hex');
exports.SPACER_HEIGHT_MAX = new Buffer('ffffffffff', 'hex');
exports.TIMESTAMP_MIN = new Buffer('0000000000000000', 'hex');
exports.TIMESTAMP_MAX = new Buffer('ffffffffffffffff', 'hex');

// The maximum number of inputs that can be queried at once
exports.MAX_INPUTS_QUERY_LENGTH = 50000;
// The maximum number of outputs that can be queried at once
exports.MAX_OUTPUTS_QUERY_LENGTH = 50000;
// The maximum number of transactions that can be queried at once
exports.MAX_HISTORY_QUERY_LENGTH = 100;
// The maximum number of addresses that can be queried at once
exports.MAX_ADDRESSES_QUERY = 10000;
// The maximum number of simultaneous requests
exports.MAX_ADDRESSES_LIMIT = 5;

module.exports = exports;

