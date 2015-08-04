'use strict';

var EventEmitter = require('events').EventEmitter;
var binary = require('node-pre-gyp');
var path = require('path');
var binding_path = binary.find(path.resolve(path.join(__dirname,'../package.json')));
var bitcoind = require(binding_path);
var util = require('util');
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

  this.config = this.datadir + '/bitcoin.conf';

  Object.keys(exports).forEach(function(key) {
    self[key] = exports[key];
  });

  this.on('newListener', function(name) {
    if (name === 'open') {
      self.start();
    }
  });
}

util.inherits(Daemon, EventEmitter);

// Make sure signal handlers are not overwritten
Daemon._signalQueue = [];
Daemon._processOn = process.on;
process.addListener =
process.on = function(name, listener) {
  if (~['SIGINT', 'SIGHUP', 'SIGQUIT'].indexOf(name.toUpperCase())) {
    if (!Daemon.global || !Daemon.global._started) {
      Daemon._signalQueue.push([name, listener]);
      return;
    }
  }
  return Daemon._processOn.apply(this, arguments);
};

Daemon.instances = {};
Daemon.prototype.instances = Daemon.instances;

Daemon.__defineGetter__('global', function() {
  return Daemon.instances[Object.keys(Daemon.instances)[0]];
});

Daemon.prototype.__defineGetter__('global', function() {
  return Daemon.global;
});

Daemon.prototype.start = function(options, callback) {
  var self = this;

  if (!callback) {
    callback = options;
    options = null;
  }

  if (!options) {
    options = {};
  }

  if (!callback) {
    callback = function() {};
  }

  if (this.instances[this.datadir]) {
    return;
  }
  this.instances[this.datadir] = true;

  var none = {};
  var isSignal = {};
  var sigint = { name: 'SIGINT', signal: isSignal };
  var sighup = { name: 'SIGHUP', signal: isSignal };
  var sigquit = { name: 'SIGQUIT', signal: isSignal };
  var exitCaught = none;
  var errorCaught = none;

  Object.keys(this.options).forEach(function(key) {
    if (options[key] == null) {
      options[key] = self.options[key];
    }
  });

  bitcoind.start(options, function(err, status) {
    self._started = true;

    // Poll for queued packet
    [sigint, sighup, sigquit].forEach(function(signal) {
      process.on(signal.name, signal.listener = function() {
        if (process.listeners(signal.name).length > 1) {
          return;
        }
        if (!self._shutdown) {
          process.exit(0);
        } else {
          self.stop();
          exitCaught = signal;
        }
      });
    });

    // Finally set signal handlers
    process.on = process.addListener = Daemon._processOn;
    Daemon._signalQueue.forEach(function(event) {
      process.on(event[0], event[1]);
    });

    var exit = process.exit;
    self._exit = function() {
      return exit.apply(process, arguments);
    };

    process.exit = function(code) {
      exitCaught = code || 0;
      if (!self._shutdown) {
        return self._exit(code);
      }
      self.stop();
    };

    process.on('uncaughtException', function(err) {
      if (process.listeners('uncaughtException').length > 1) {
        return;
      }
      errorCaught = err;
      self.error('Uncaught error: shutting down safely before throwing...');
      if (!self._shutdown) {
        if (err && err.stack) {
          console.error(err.stack);
        }
        self._exit(1);
        return;
      }
      self.stop();
    });

    bitcoind.onBlocksReady(function(err, result) {

      function onTipUpdateListener(result) {
        if (result) {
          // Emit and event that the tip was updated
          self.emit('tip', result);
          // Recursively wait until the next update
          bitcoind.onTipUpdate(onTipUpdateListener);
        }
      }

      bitcoind.onTipUpdate(onTipUpdateListener);

      self.emit('ready', result);

      bitcoind.startTxMon(function(txs) {
        for(var i = 0; i < txs.length; i++) {
          self.emit('tx', txs[i]);
        }
      });

    });

    setTimeout(function callee() {
      // Wait until wallet is loaded:
      if (callback) {
        callback(err ? err : null);
      }

      if (err) {
        self.emit('error', err);
      } else {
        if (callback) {
          self.emit('open', status);
        } else {
          self.emit('status', status);
        }
      }

      if (callback) {
        callback = null;
      }
    }, 100);
  });

  // bitcoind's boost threads aren't in the thread pool
  // or on node's event loop, so we need to keep node open.
  this._shutdown = setInterval(function() {
    if (!self._stoppingSaid && bitcoind.stopping()) {
      self._stoppingSaid = true;
    }

    if (bitcoind.stopped()) {

      clearInterval(self._shutdown);
      delete self._shutdown;

      if (exitCaught !== none) {
        if (exitCaught.signal === isSignal) {
          process.removeListener(exitCaught.name, exitCaught.listener);
          setImmediate(function() {
            process.kill(process.pid, exitCaught.name);
          });
          return;
        } else if (errorCaught && errorCaught.stack) {
          console.error(errorCaught.stack);
        }
        return self._exit(exitCaught);
      }
    }
  }, 1000);
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
  if (Daemon.stopping) return [];
  var self = this;
  return bitcoind.stop(function(err, status) {
    if (err) {
      self.error(err.message);
    } else {
      log.info(status);
    }
    if (!callback) return;
    return callback(err, status);
  });
};

Daemon.prototype.__defineGetter__('stopping', function() {
  return bitcoind.stopping() || bitcoind.stopped();
});

Daemon.prototype.__defineGetter__('stopped', function() {
  return bitcoind.stopped();
});

Daemon.__defineGetter__('stopping', function() {
  return bitcoind.stopping() || bitcoind.stopped();
});

Daemon.__defineGetter__('stopped', function() {
  return bitcoind.stopped();
});

module.exports = Daemon;
