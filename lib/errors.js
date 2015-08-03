'use strict';

var createError = require('errno').create;
var chainlib = require('chainlib');

var errors = chainlib.errors;

errors.Transaction = createError('Transaction', errors.Error);
errors.Transaction.NotFound = createError('NotFound', errors.Transaction);

module.exports = errors;
