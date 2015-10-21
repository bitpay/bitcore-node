'use strict';

var fs = require('fs');
var util = require('util');
var bindings = require('bindings')('bitcoind.node');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore-lib');
var $ = bitcore.util.preconditions;
var index = require('../');
var log = index.log;
var Service = require('../service');

/**
 * Provides an interface to native bindings to [Bitcoin Core](https://github.com/bitcoin/bitcoin)
 * compiled as a static library. The C++ bindings can be found at `src/libbitcoind.cc`
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 */
function Bitcoin(options) {
  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  this._reindex = false;
  this._reindexWait = 1000;
  Service.call(this, options);
  $.checkState(this.node.datadir, 'Node is missing datadir property');
}

util.inherits(Bitcoin, Service);

Bitcoin.dependencies = [];

Bitcoin.DEFAULT_CONFIG = 'whitelist=127.0.0.1\n' + 'txindex=1\n';

Bitcoin.prototype._loadConfiguration = function() {
  /* jshint maxstatements: 25 */

  $.checkArgument(this.node.datadir, 'Please specify "datadir" in configuration options');
  var configPath = this.node.datadir + '/bitcoin.conf';
  this.configuration = {};

  if (!fs.existsSync(this.node.datadir)) {
    mkdirp.sync(this.node.datadir);
  }

  if (!fs.existsSync(configPath)) {
    var defaultConfig = Bitcoin.DEFAULT_CONFIG;
    if(this.node.https && this.node.httpsOptions) {
      defaultConfig += 'rpcssl=1\n';
      defaultConfig += 'rpcsslprivatekeyfile=' + this.node.httpsOptions.key + '\n';
      defaultConfig += 'rpcsslcertificatechainfile=' + this.node.httpsOptions.cert + '\n';
    }
    fs.writeFileSync(configPath, defaultConfig);
  }

  var file = fs.readFileSync(configPath);
  var unparsed = file.toString().split('\n');
  for(var i = 0; i < unparsed.length; i++) {
    var line = unparsed[i];
    if (!line.match(/^\#/) && line.match(/\=/)) {
      var option = line.split('=');
      var value;
      if (!Number.isNaN(Number(option[1]))) {
        value = Number(option[1]);
      } else {
        value = option[1];
      }
      this.configuration[option[0]] = value;
    }
  }

  $.checkState(
    this.configuration.txindex && this.configuration.txindex === 1,
    'Txindex option is required in order to use most of the features of bitcore-node. ' +
      'Please add "txindex=1" to your configuration and reindex an existing database if ' +
      'necessary with reindex=1'
  );

  if (this.configuration.reindex && this.configuration.reindex === 1) {
    log.warn('Reindex option is currently enabled. This means that bitcoind is undergoing a reindex. ' +
      'The reindex flag will start the index from beginning every time the node is started, so it ' +
      'should be removed after the reindex has been initiated. Once the reindex is complete, the rest ' +
      'of bitcore-node services will start.');
    this._reindex = true;
  }

};

Bitcoin.prototype._onTipUpdate = function(result) {
  if (result) {
    // Emit and event that the tip was updated
    this.height = result;
    this.emit('tip', result);

    // TODO stopping status
    if(!this.node.stopping) {
      var percentage = this.syncPercentage();
      log.info('Bitcoin Height:', this.height, 'Percentage:', percentage);
    }

    // Recursively wait until the next update
    bindings.onTipUpdate(this._onTipUpdate.bind(this));
  }
};

Bitcoin.prototype._registerEventHandlers = function() {
  var self = this;

  // Set the height and emit a new tip
  bindings.onTipUpdate(self._onTipUpdate.bind(this));

  // Register callback function to handle incoming transactions
  bindings.startTxMon(function(txs) {
    for(var i = 0; i < txs.length; i++) {
      self.emit('tx', txs[i]);
    }
  });
};

Bitcoin.prototype._onReady = function(result, callback) {
  var self = this;

  self._registerEventHandlers();

  var info = self.getInfo();
  self.height = info.blocks;

  self.getBlock(0, function(err, block) {
    if (err) {
      return callback(err);
    }
    self.genesisBuffer = block;
    self.emit('ready', result);
    log.info('Bitcoin Daemon Ready');
    callback();
  });

};

/**
 * Called by Node to start the service
 * @param {Function} callback
 */
Bitcoin.prototype.start = function(callback) {
  var self = this;

  this._loadConfiguration();

  bindings.start({
    datadir: this.node.datadir,
    network: this.node.network.name
  }, function(err) {
    if(err) {
      return callback(err);
    }
    // Wait until the block chain is ready
    bindings.onBlocksReady(function(err, result) {
      if (err) {
        return callback(err);
      }
      if (self._reindex) {
        var interval = setInterval(function() {
          var percentSynced = bindings.syncPercentage();
          log.info("Bitcoin Core Daemon Reindex Percentage: " + percentSynced);
          if (percentSynced >= 100) {
            self._reindex = false;
            self._onReady(result, callback);
            clearInterval(interval);
          }
        }, self._reindexWait);

      }
      else {
        self._onReady(result, callback);
      }
    });
  });
};

/**
 * Helper to determine the state of the database.
 * @returns {Boolean} If the database is fully synced
 */
Bitcoin.prototype.isSynced = function() {
  return bindings.isSynced();
};

/**
 * Helper to determine the progress of the database.
 * @returns {Number} An estimated percentage of the syncronization status
 */
Bitcoin.prototype.syncPercentage = function() {
  return bindings.syncPercentage();
};

/**
 * Will retreive a block as a Node.js Buffer from disk.
 * @param {String|Number} block - A block hash or block height number
 */
Bitcoin.prototype.getBlock = function(block, callback) {
  return bindings.getBlock(block, callback);
};

/**
 * Will return the spent status of an output (not including the mempool)
 * @param {String} txid - The transaction hash
 * @param {Number} outputIndex - The output index in the transaction
 * @returns {Boolean} If the output has been spent
 */
Bitcoin.prototype.isSpent = function(txid, outputIndex) {
  return bindings.isSpent(txid, outputIndex);
};

/**
 * Will return the block index information, the output will have the format:
 * {
 *   prevHash: '7194fcf33f58c96720f88f21ab28c34ebc5638c5f88d7838517deb27313b59de',
 *   hash: '7c5caf0af1bf16e3467b275a3b408bc1d251bff3c25be20cb727c47b66a7b216',
 *   chainWork: '0000000000000000000000000000000000000000000000000000000000000016',
 *   height: 10
 * }
 * @param {String|Number} block - A block hash or block height
 * @returns {Object}
 */
Bitcoin.prototype.getBlockIndex = function(block) {
  return bindings.getBlockIndex(block);
};

/**
 * Will return if the block is a part of the main chain.
 * @param {String} blockHash
 * @returns {Boolean}
 */
Bitcoin.prototype.isMainChain = function(blockHash) {
  return bindings.isMainChain(blockHash);
};

/**
 * Will estimate the fee per kilobyte.
 * @param {Number} blocks - The number of blocks for the transaction to be confirmed.
 * @returns {Number}
 */
Bitcoin.prototype.estimateFee = function(blocks) {
  return bindings.estimateFee(blocks);
};

/**
 * Will add a transaction to the mempool and relay to connected peers, the function
 * will throw an error if there were validation problems.
 * @param {String} transaction - The hex string of the transaction
 * @param {Boolean} allowAbsurdFees - Enable large fees
 */
Bitcoin.prototype.sendTransaction = function(transaction, allowAbsurdFees) {
  return bindings.sendTransaction(transaction, allowAbsurdFees);
};

/**
 * Will get a transaction as a Node.js Buffer from disk and the mempool.
 * @param {String} txid - The transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Bitcoin.prototype.getTransaction = function(txid, queryMempool, callback) {
  return bindings.getTransaction(txid, queryMempool, callback);
};

/**
 * Will get a transation with additional information about the block, in the format:
 * {
 *   blockHash: '2725743288feae6bdaa976590af7cb12d7b535b5a242787de6d2789c73682ed1',
 *   height: 48,
 *   timestamp: 1442951110, // in seconds
 *   buffer: <Buffer...> // transaction buffer
 * }
 * @param {String} txid - The transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Bitcoin.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  return bindings.getTransactionWithBlockInfo(txid, queryMempool, callback);
};

/**
 * Will return the entire mempool as an Array of transaction Buffers.
 * @returns {Array}
 */
Bitcoin.prototype.getMempoolTransactions = function() {
  return bindings.getMempoolTransactions();
};

/**
 * Will add a transaction to the mempool without any validation. This is used
 * exclusively for testing purposes.
 * @param {String} transaction - The hex string for the transaction
 */
Bitcoin.prototype.addMempoolUncheckedTransaction = function(transaction) {
  return bindings.addMempoolUncheckedTransaction(transaction);
};

/**
 * Will get the best block hash for the chain.
 * @returns {String}
 */
Bitcoin.prototype.getBestBlockHash = function() {
  return bindings.getBestBlockHash();
};

/**
 * Will get the next block hash for a block hash.
 * @param {String} hash - The starting block hash
 * @returns {String}
 */
Bitcoin.prototype.getNextBlockHash = function(hash) {
  return bindings.getNextBlockHash(hash);
};

/**
 * This will return information about the database in the format:
 * {
 *   version: 110000,
 *   protocolversion: 70002,
 *   blocks: 151,
 *   timeoffset: 0,
 *   connections: 0,
 *   difficulty: 4.6565423739069247e-10,
 *   testnet: false,
 *   relayfee: 1000,
 *   errors: ''
 * }
 */
Bitcoin.prototype.getInfo = function() {
  return bindings.getInfo();
};

/**
 * Called by Node to stop the service.
 * @param {Function} callback
 */
Bitcoin.prototype.stop = function(callback) {
  return bindings.stop(function(err, status) {
    if (err) {
      return callback(err);
    } else {
      log.info(status);
      return callback();
    }
  });
};

module.exports = Bitcoin;
