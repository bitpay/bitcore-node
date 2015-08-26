'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var bitcoind = require('bindings')('bitcoind.node');
var index = require('./');
var log = index.log;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;

function Daemon(options) {
  var self = this;

  if (!(this instanceof Daemon)) {
    return new Daemon(options);
  }

  if (Object.keys(this.instances).length) {
    throw new Error('Daemon cannot be instantiated more than once.');
  }

  EventEmitter.call(this);

  $.checkArgument(options.datadir, 'Please specify a datadir');

  this.options = options || {};
  this.options.datadir = this.options.datadir.replace(/^~/, process.env.HOME);
  this.datadir = this.options.datadir;

  this.node = options.node;

  this.config = this.datadir + '/bitcoin.conf';

  Object.keys(exports).forEach(function(key) {
    self[key] = exports[key];
  });

}

util.inherits(Daemon, EventEmitter);

Daemon.instances = {};
Daemon.prototype.instances = Daemon.instances;

Daemon.__defineGetter__('global', function() {
  return Daemon.instances[Object.keys(Daemon.instances)[0]];
});

Daemon.prototype.__defineGetter__('global', function() {
  return Daemon.global;
});

Daemon.prototype.start = function(callback) {
  var self = this;

  if (this.instances[this.datadir]) {
    return callback(new Error('Daemon already started'));
  }
  this.instances[this.datadir] = true;

  bitcoind.start(this.options, function(err) {
    if(err) {
      return callback(err);
    }

    self._started = true;

    bitcoind.onBlocksReady(function(err, result) {

      function onTipUpdateListener(result) {
        if (result) {
          // Emit and event that the tip was updated
          self.height = result;
          self.emit('tip', result);
          // Recursively wait until the next update
          bitcoind.onTipUpdate(onTipUpdateListener);
        }
      }

      bitcoind.onTipUpdate(onTipUpdateListener);

      bitcoind.startTxMon(function(txs) {
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
        setImmediate(callback);
      });

    });
  });
};

Daemon.prototype.isSynced = function() {
  return bitcoind.isSynced();
};

Daemon.prototype.syncPercentage = function() {
  return bitcoind.syncPercentage();
};

Daemon.prototype.getBlock = function(blockhash, callback) {
  return bitcoind.getBlock(blockhash, callback);
};

Daemon.prototype.isSpent = function(txid, outputIndex) {
  return bitcoind.isSpent(txid, outputIndex);
};

Daemon.prototype.getBlockIndex = function(blockHash) {
  return bitcoind.getBlockIndex(blockHash);
};

Daemon.prototype.estimateFee = function(blocks) {
  return bitcoind.estimateFee(blocks);
};

Daemon.prototype.sendTransaction = function(transaction, allowAbsurdFees) {
  return bitcoind.sendTransaction(transaction, allowAbsurdFees);
};

Daemon.prototype.getTransaction = function(txid, queryMempool, callback) {
  return bitcoind.getTransaction(txid, queryMempool, callback);
};

Daemon.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  return bitcoind.getTransactionWithBlockInfo(txid, queryMempool, callback);
};

Daemon.prototype.getMempoolOutputs = function(address) {
  return bitcoind.getMempoolOutputs(address);
};

Daemon.prototype.addMempoolUncheckedTransaction = function(txBuffer) {
  return bitcoind.addMempoolUncheckedTransaction(txBuffer);
};

Daemon.prototype.getInfo = function() {
  return bitcoind.getInfo();
};

Daemon.prototype.stop = function(callback) {
  var self = this;
  return bitcoind.stop(function(err, status) {
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

module.exports = Daemon;
