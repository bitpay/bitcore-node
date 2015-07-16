'use strict';

module.exports = {};
module.exports.bitcoind = require('./lib/bitcoind');
module.exports.Node = require('./lib/node');
module.exports.Block = require('./lib/block');
module.exports.Chain = require('./lib/chain');
module.exports.DB = require('./lib/db');
module.exports.Transaction = require('./lib/transaction');
module.exports.errors = require('./lib/errors');

module.exports.deps = {};
module.exports.deps.chainlib = require('chainlib');