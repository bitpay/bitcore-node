'use strict';

var util = require('util');
var bindings = require('bindings')('bitcoind.node');
var mkdirp = require('mkdirp');
var fs = require('fs');
var bitcore = require('bitcore');
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

  var self = this;

  Service.call(this, options);

  if (Object.keys(this.instances).length) {
    throw new Error('Bitcoin cannot be instantiated more than once.');
  }

  $.checkState(this.node.datadir, 'Node is missing datadir property');

  Object.keys(exports).forEach(function(key) {
    self[key] = exports[key];
  });

}

util.inherits(Bitcoin, Service);

Bitcoin.dependencies = [];

Bitcoin.instances = {};
Bitcoin.prototype.instances = Bitcoin.instances;

Bitcoin.__defineGetter__('global', function() {
  return Bitcoin.instances[Object.keys(Bitcoin.instances)[0]];
});

Bitcoin.prototype.__defineGetter__('global', function() {
  return Bitcoin.global;
});

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
    fs.writeFileSync(configPath, Bitcoin.DEFAULT_CONFIG);
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
};

Bitcoin.prototype.start = function(callback) {
  var self = this;

  this._loadConfiguration();

  if (this.instances[this.datadir]) {
    return callback(new Error('Bitcoin already started'));
  }
  this.instances[this.datadir] = true;

  bindings.start({
    datadir: this.node.datadir,
    network: this.node.network.name
  }, function(err) {
    if(err) {
      return callback(err);
    }

    self._started = true;

    bindings.onBlocksReady(function(err, result) {

      function onTipUpdateListener(result) {
        if (result) {
          // Emit and event that the tip was updated
          self.height = result;
          self.emit('tip', result);

          // TODO stopping status
          if(!self.stopping) {
            var percentage = self.syncPercentage();
            log.info('Bitcoin Core Daemon New Height:', self.height, 'Percentage:', percentage);
          }

          // Recursively wait until the next update
          bindings.onTipUpdate(onTipUpdateListener);
        }
      }

      bindings.onTipUpdate(onTipUpdateListener);

      bindings.startTxMon(function(txs) {
        for(var i = 0; i < txs.length; i++) {
          self.emit('tx', txs[i]);
        }
      });

      // Set the current chain height
      var info = self.getInfo();
      self.height = info.blocks;

      // Get the genesis block
      self.getBlock(0, function(err, block) {
        self.genesisBuffer = block;
        self.emit('ready', result);
        log.info('Bitcoin Daemon Ready');
        setImmediate(callback);
      });

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

Bitcoin.prototype.getMempoolOutputs = function(address) {
  return bindings.getMempoolOutputs(address);
};

Bitcoin.prototype.addMempoolUncheckedTransaction = function(txBuffer) {
  return bindings.addMempoolUncheckedTransaction(txBuffer);
};

Bitcoin.prototype.getInfo = function() {
  return bindings.getInfo();
};

Bitcoin.prototype.stop = function(callback) {
  return bindings.stop(function(err, status) {
    setImmediate(function() {
      if (err) {
        return callback(err);
      } else {
        log.info(status);
        return callback();
      }
    });
  });
};

module.exports = Bitcoin;
