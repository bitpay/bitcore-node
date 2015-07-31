'use strict';

var util = require('util');
var chainlib = require('chainlib');
var BaseDB = chainlib.DB;
var Transaction = require('./transaction');
var async = require('async');
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var BufferWriter = bitcore.encoding.BufferWriter;
var errors = require('./errors');
var levelup = chainlib.deps.levelup;
var log = chainlib.log;
var Address = bitcore.Address;
var BaseModule = require('./module');
var AddressModule = require('./modules/address');

function DB(options) {
  if(!options) {
    options = {};
  }

  BaseDB.call(this, options);

  this.coinbaseAddress = options.coinbaseAddress;
  this.coinbaseAmount = options.coinbaseAmount || 50 * 1e8;
  this.Transaction = Transaction;

  this.network = bitcore.Networks.get(options.network) || bitcore.Networks.testnet;
  this.modules = [];

  // Add address module
  this.addModule(AddressModule);

  // Add other modules
  if(options.modules && options.modules.length) {
    for(var i = 0; i < options.modules.length; i++) {
      this.addModule(options.modules[i]);
    }
  }
}

util.inherits(DB, BaseDB);

DB.prototype.getBlock = function(hash, callback) {
  var self = this;

  // get block from bitcoind
  this.bitcoind.getBlock(hash, function(err, blockData) {
    if(err) {
      return callback(err);
    }
    callback(null, self.Block.fromBuffer(blockData));
  });
};

DB.prototype.getPrevHash = function(blockHash, callback) {
  var blockIndex = this.bitcoind.getBlockIndex(blockHash);
  setImmediate(function() {
    if (blockIndex) {
      callback(null, blockIndex.prevHash);
    } else {
      callback(new Error('Could not get prevHash, block not found'));
    }
  });
};

DB.prototype.putBlock = function(block, callback) {
  // block is already stored in bitcoind
  setImmediate(callback);
};

DB.prototype.getTransaction = function(txid, queryMempool, callback) {
  this.bitcoind.getTransaction(txid, queryMempool, function(err, txBuffer) {
    if(err) {
      return callback(err);
    }

    callback(null, Transaction().fromBuffer(txBuffer));
  });
};

DB.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  this.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, obj) {
    if(err) {
      return callback(err);
    }

    var tx = Transaction().fromBuffer(obj.buffer);
    tx.__height = obj.height;
    tx.__timestamp = obj.timestamp;

    callback(null, tx);
  });
}

DB.prototype.validateBlockData = function(block, callback) {
  // bitcoind does the validation
  setImmediate(callback);
};

DB.prototype._updatePrevHashIndex = function(block, callback) {
  // bitcoind has the previous hash for each block
  setImmediate(callback);
};

DB.prototype._updateWeight = function(hash, weight, callback) {
  // bitcoind has all work for each block
  setImmediate(callback);
};

DB.prototype.buildGenesisData = function() {
  var coinbaseTx = this.buildCoinbaseTransaction();
  var bw = new BufferWriter();
  bw.writeVarintNum(1);
  bw.write(coinbaseTx.toBuffer());
  var merkleRoot = this.getMerkleRoot([coinbaseTx]);
  var buffer = bw.concat();
  return {
    merkleRoot: merkleRoot,
    buffer: buffer
  };
};

DB.prototype.buildCoinbaseTransaction = function(transactions, data) {
  if(!this.coinbaseAddress) {
    throw new Error('coinbaseAddress required to build coinbase');
  }

  if(!data) {
    data = bitcore.crypto.Random.getRandomBuffer(40);
  }

  var fees = 0;

  if(transactions && transactions.length) {
    fees = this.getInputTotal(transactions) - this.getOutputTotal(transactions, true);
  }

  var coinbaseTx = new this.Transaction();
  coinbaseTx.to(this.coinbaseAddress, this.coinbaseAmount + fees);

  var script = bitcore.Script.buildDataOut(data);

  var input = new bitcore.Transaction.Input({
    prevTxId: '0000000000000000000000000000000000000000000000000000000000000000',
    outputIndex: 0xffffffff,
    sequenceNumber: 4294967295,
    script: script
  });

  coinbaseTx.inputs = [input];
  return coinbaseTx;
};

DB.prototype.getOutputTotal = function(transactions, excludeCoinbase) {
  var totals = transactions.map(function(tx) {
    if(tx.isCoinbase() && excludeCoinbase) {
      return 0;
    } else {
      return tx._getOutputAmount();
    }
  });
  var grandTotal = totals.reduce(function(previousValue, currentValue) {
    return previousValue + currentValue;
  });
  return grandTotal;
};

DB.prototype.getInputTotal = function(transactions) {
  var totals = transactions.map(function(tx) {
    if(tx.isCoinbase()) {
      return 0;
    } else {
      return tx._getInputAmount();
    }
  });
  var grandTotal = totals.reduce(function(previousValue, currentValue) {
    return previousValue + currentValue;
  });
  return grandTotal;
};

DB.prototype._onChainAddBlock = function(block, callback) {
  log.debug('DB handling new chain block');

  // Remove block from mempool
  this.mempool.removeBlock(block.hash);
  this.blockHandler(block, true, callback);
};

DB.prototype._onChainRemoveBlock = function(block, callback) {
  log.debug('DB removing chain block');
  this.blockHandler(block, false, callback);
};

DB.prototype.blockHandler = function(block, add, callback) {
  var self = this;
  var operations = [];

  async.eachSeries(
    this.modules,
    function(module, next) {
      module['blockHandler'].call(module, block, add, function(err, ops) {
        if(err) {
          return next(err);
        }

        operations = operations.concat(ops);
        next();
      });
    },
    function(err) {
      if (err) {
        return callback(err);
      }

      log.debug('Updating the database with operations', operations);

      self.store.batch(operations, callback);
    }
  );
};

DB.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getTransaction', this, this.getTransaction, 2]
  ];

  for(var i = 0; i < this.modules.length; i++) {
    methods = methods.concat(this.modules[i]['getAPIMethods'].call(this.modules[i]));
  }

  return methods;
};

DB.prototype.addModule = function(Module) {
  var module = new Module({
    db: this
  });
  $.checkArgumentType(module, BaseModule);
  this.modules.push(module);
};

module.exports = DB;
