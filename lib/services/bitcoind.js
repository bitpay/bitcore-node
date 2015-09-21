'use strict';

var fs = require('fs');
var util = require('util');
var bindings = require('bindings')('bitcoind.node');
var mkdirp = require('mkdirp');
var async = require('async');
var bitcore = require('bitcore');
var Transaction = require('../transaction');
var $ = bitcore.util.preconditions;
var index = require('../');
var log = index.log;
var Service = require('../service');

/**
 * Provides an interface to native bindings to Bitcoin Core
 * @param {Object} options
 * @param {String} options.datadir - The bitcoin data directory
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
      log.info('Bitcoin Core Daemon New Height:', this.height, 'Percentage:', percentage);
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

Bitcoin.prototype.isSynced = function() {
  return bindings.isSynced();
};

Bitcoin.prototype.syncPercentage = function() {
  return bindings.syncPercentage();
};

Bitcoin.prototype.getBlock = function(blockhash, callback) {
  return bindings.getBlock(blockhash, callback);
};

Bitcoin.prototype.isSpent = function(txid, outputIndex) {
  return bindings.isSpent(txid, outputIndex);
};

Bitcoin.prototype.getBlockIndex = function(blockHash) {
  return bindings.getBlockIndex(blockHash);
};

Bitcoin.prototype.isMainChain = function(blockHash) {
  return bindings.isMainChain(blockHash);
};

Bitcoin.prototype.estimateFee = function(blocks) {
  return bindings.estimateFee(blocks);
};

Bitcoin.prototype.sendTransaction = function(transaction, allowAbsurdFees) {
  return bindings.sendTransaction(transaction, allowAbsurdFees);
};

Bitcoin.prototype.getTransaction = function(txid, queryMempool, callback) {
  return bindings.getTransaction(txid, queryMempool, callback);
};

Bitcoin.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  return bindings.getTransactionWithBlockInfo(txid, queryMempool, callback);
};

Bitcoin.prototype.getMempoolTransactions = function() {
  return bindings.getMempoolTransactions();
};

Bitcoin.prototype.addMempoolUncheckedTransaction = function(txBuffer) {
  return bindings.addMempoolUncheckedTransaction(txBuffer);
};

Bitcoin.prototype.getBestBlockHash = function() {
  return bindings.getBestBlockHash();
};

Bitcoin.prototype.getNextBlockHash = function(hash) {
  return bindings.getNextBlockHash(hash);
};

Bitcoin.prototype.getTxOutSetInfo = function() {
  return bindings.getTxOutSetInfo();
};

Bitcoin.prototype.getInfo = function() {
  return bindings.getInfo();
};

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
