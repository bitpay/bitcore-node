'use strict';

module.exports = {};
module.exports.daemon = require('./lib/daemon');
module.exports.Node = require('./lib/node');
module.exports.Block = require('./lib/block');
module.exports.Chain = require('./lib/chain');
module.exports.DB = require('./lib/db');
module.exports.Transaction = require('./lib/transaction');
module.exports.Module = require('./lib/module');
module.exports.errors = require('./lib/errors');

module.exports.modules = {};
module.exports.modules.AddressModule = require('./lib/modules/address');

module.exports.deps = {};
module.exports.deps.chainlib = require('chainlib');