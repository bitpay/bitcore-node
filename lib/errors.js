'use strict';

var createError = require('errno').create;

var BitcoreNodeError = createError('BitcoreNodeError');
var NoOutputs = createError('NoOutputs', BitcoreNodeError);
var NoOutput = createError('NoOutput', BitcoreNodeError);

var Wallet = createError('WalletError', BitcoreNodeError);
Wallet.InsufficientFunds = createError('InsufficientFunds', Wallet);

var Consensus = createError('Consensus', BitcoreNodeError);
Consensus.BlockExists = createError('BlockExists', Consensus);

var Transaction = createError('Transaction', BitcoreNodeError);
Transaction.NotFound = createError('NotFound', Transaction);

module.exports = {
  Error: BitcoreNodeError,
  NoOutputs: NoOutputs,
  NoOutput: NoOutput,
  Wallet: Wallet,
  Consensus: Consensus,
  Transaction: Transaction
};
