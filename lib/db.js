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
var log = chainlib.log;
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

  // Modules to be loaded when ready
  this._modules = options.modules || [];
  this._modules.push(AddressModule);

  this.modules = [];

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

util.inherits(DB, BaseDB);

DB.prototype.initialize = function() {
  // Add all db option modules
  if(this._modules && this._modules.length) {
    for(var i = 0; i < this._modules.length; i++) {
      this.addModule(this._modules[i]);
    }
  }
  this.bitcoind.on('tx', this.transactionHandler.bind(this));
  this.emit('ready');
}

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
    if(!txBuffer) {
      return callback(new errors.Transaction.NotFound());
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
};

DB.prototype.sendTransaction = function(tx, callback) {
  if(tx instanceof this.Transaction) {
    tx = tx.toString();
  }
  $.checkArgument(typeof tx === 'string', 'Argument must be a hex string or Transaction');

  try {
    var txid = this.bitcoind.sendTransaction(tx);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

DB.prototype.estimateFee = function(blocks, callback) {
  var self = this;

  // For some reason getting fee for 1 block returns -1
  // Until this is resolved, just make it 2 blocks
  if(blocks === 1) {
    blocks = 2;
  }

  setImmediate(function() {
    callback(null, self.bitcoind.estimateFee(blocks));
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

  // Notify block subscribers
  for(var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.transaction[i].emit('block', block.hash);
  }

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
    ['getTransaction', this, this.getTransaction, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1]
  ];

  for(var i = 0; i < this.modules.length; i++) {
    methods = methods.concat(this.modules[i]['getAPIMethods'].call(this.modules[i]));
  }

  return methods;
};

DB.prototype.getPublishEvents = function() {
  return [
    {
      name: 'transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];
};

DB.prototype.addModule = function(Module) {
  var module = new Module({
    db: this
  });
  $.checkArgumentType(module, BaseModule);
  this.modules.push(module);
};

DB.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
};

DB.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if(index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
};

DB.prototype.transactionHandler = function(txInfo) {
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);
  for(var i = 0; i < this.subscriptions.transaction.length; i++) {
    this.subscriptions.transaction[i].emit('transaction', {
      rejected: !txInfo.mempool,
      tx: tx
    });
  }
};

module.exports = DB;
