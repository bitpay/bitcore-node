var net = require('net');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('bindings')('bitcoindjs.node');
var util = require('util');
var fs = require('fs');
var mkdirp = require('mkdirp');
var tiny = require('tiny').json;
var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;

var daemon = Daemon;

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

  this.network = Daemon.livenet;

  if (this.options.network === 'testnet') {
    this.network = Daemon.testnet;
  } else if(this.options.network === 'regtest') {
    this.network = Daemon.regtest;
  }

  Object.keys(exports).forEach(function(key) {
    self[key] = exports[key];
  });

  this.on('newListener', function(name) {
    if (name === 'open') {
      self.start();
    }
  });
}

Daemon.prototype.__proto__ = EventEmitter.prototype;

Daemon.livenet = {
  name: 'livenet',
  peers: [
    // hardcoded peers
  ]
};

Daemon.testnet = {
  name: 'testnet',
  peers: [
    // hardcoded peers
  ]
};

Daemon.regtest = {
  name: 'regtest',
  peers: [
    // hardcoded peers
  ]
};

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
  if (daemon.stopping) return [];
  return Daemon.instances[Object.keys(Daemon.instances)[0]];
});

Daemon.prototype.__defineGetter__('global', function() {
  if (daemon.stopping) return [];
  return Daemon.global;
});

tiny.debug = function() {};
tiny.prototype.debug = function() {};
tiny.error = function() {};
tiny.prototype.error = function() {};

Daemon.db = tiny({
  file: process.env.HOME + '/.bitcoindjs.db',
  saveIndex: false,
  initialCache: false
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
    callback = utils.NOOP;
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

  bitcoindjs.start(options, function(err, status) {
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

    bitcoindjs.onBlocksReady(function(err, result) {

      function onTipUpdateListener(result) {
        if (result) {
          // Emit and event that the tip was updated
          self.emit('tip', result);
          // Recursively wait until the next update
          bitcoindjs.onTipUpdate(onTipUpdateListener);
        }
      }

      bitcoindjs.onTipUpdate(onTipUpdateListener);

      self.emit('ready', result);

      bitcoindjs.startTxMon(function(txs) {
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
    if (!self._stoppingSaid && bitcoindjs.stopping()) {
      self._stoppingSaid = true;
      self.log('shutting down...');
    }

    if (bitcoindjs.stopped()) {
      self.log('shut down.');

      clearInterval(self._shutdown);
      delete self._shutdown;

      if (exitCaught !== none) {
        if (exitCaught.signal === isSignal) {
          process.removeListener(exitCaught.name, exitCaught.listener);
          setImmediate(function() {
            process.kill(process.pid, exitCaught.name);
          });
          return;
        }
        return self._exit(exitCaught);
      }

      if (errorCaught !== none) {
        if (errorCaught && errorCaught.stack) {
          console.error(errorCaught.stack);
        }
        return self._exit(0);
      }
    }
  }, 1000);
};

Daemon.prototype.getBlock = function(blockhash, callback) {
  if (daemon.stopping) return [];
  return bitcoindjs.getBlock(blockhash, function(err, block) {
    if (err) return callback(err);
    return callback(null, block);
  });
};

Daemon.prototype.getBlockHeight = function(height, callback) {
  if (daemon.stopping) return [];
  return bitcoindjs.getBlock(+height, function(err, block) {
    if (err) return callback(err);
    return callback(null, daemon.block(block));
  });
};

Daemon.prototype.isSpent = function(txid, outputIndex) {
  return bitcoindjs.isSpent(txid, outputIndex);
};

Daemon.prototype.getBlockIndex = function(blockHash) {
  return bitcoindjs.getBlockIndex(blockHash);
};

Daemon.prototype.estimateFee = function(blocks) {
  return bitcoindjs.estimateFee(blocks);
};

Daemon.prototype.sendTransaction = function(transaction, allowAbsurdFees) {
  return bitcoindjs.sendTransaction(transaction, allowAbsurdFees);
};

Daemon.prototype.getTransaction = function(txid, queryMempool, callback) {
  return bitcoindjs.getTransaction(txid, queryMempool, callback);
};

Daemon.prototype.getTransactionWithBlock = function(txid, blockhash, callback) {
  if (daemon.stopping) return [];

  var self = this;
  var slow = true;

  if (typeof txid === 'object' && txid) {
    var options = txid;
    callback = blockhash;
    txid = options.txid || options.tx || options.txhash || options.id || options.hash;
    blockhash = options.blockhash || options.block;
    slow = options.slow !== false;
  }

  if (typeof blockhash === 'function') {
    callback = blockhash;
    blockhash = '';
  }

  if (typeof blockhash !== 'string') {
    if (blockhash) {
      blockhash = blockhash.hash
        || blockhash.blockhash
        || (blockhash.getHash && blockhash.getHash())
        || '';
    } else {
      blockhash = '';
    }
  }

  return bitcoindjs.getTransaction(txid, blockhash, function(err, tx) {
    if (err) return callback(err);

    if (slow && !tx.blockhash) {
      return self.getBlockByTx(txid, function(err, block, tx_) {
        if (err) return callback(err);
        return callback(null, tx, block);
      });
    }

    return bitcoindjs.getBlock(tx.blockhash, function(err, block) {
      if (err) return callback(err);
      return callback(null, daemon.tx(tx), daemon.block(block));
    });
  });
};

Daemon.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  return bitcoindjs.getTransactionWithBlockInfo(txid, queryMempool, callback);
};

Daemon.prototype.getMempoolOutputs = function(address) {
  return bitcoindjs.getMempoolOutputs(address);
};

Daemon.prototype.addMempoolUncheckedTransaction = function(txBuffer) {
  return bitcoindjs.addMempoolUncheckedTransaction(txBuffer);
};

Daemon.prototype.getInfo = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getInfo();
};

Daemon.prototype.getPeerInfo = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getPeerInfo();
};

Daemon.prototype.getAddresses = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getAddresses();
};

Daemon.prototype.getProgress = function(callback) {
  return bitcoindjs.getProgress(callback);
};

Daemon.prototype.setGenerate = function(options) {
  if (daemon.stopping) return [];
  return bitcoindjs.setGenerate(options || {});
};

Daemon.prototype.getGenerate = function(options) {
  if (daemon.stopping) return [];
  return bitcoindjs.getGenerate(options || {});
};

Daemon.prototype.getMiningInfo = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getMiningInfo();
};

Daemon.prototype.getAddrTransactions = function(address, callback) {
  if (daemon.stopping) return [];
  return daemon.db.get('addr-tx/' + address, function(err, records) {
    var options = {
      address: address,
      blockheight: (records || []).reduce(function(out, record) {
        return record.blockheight > out
          ? record.blockheight
          : out;
      }, -1),
      blocktime: (records || []).reduce(function(out, record) {
        return record.blocktime > out
          ? record.blocktime
          : out;
      }, -1)
    };
    return bitcoindjs.getAddrTransactions(options, function(err, addr) {
      if (err) return callback(err);
      addr = daemon.addr(addr);
      if (addr.tx[0] && !addr.tx[0].vout[0]) {
        return daemon.db.set('addr-tx/' + address, [{
          txid: null,
          blockhash: null,
          blockheight: null,
          blocktime: null
        }], function() {
          return callback(null, daemon.addr({
            address: addr.address,
            tx: []
          }));
        });
      }
      var set = [];
      if (records && records.length) {
        set = records;
      }
      addr.tx.forEach(function(tx) {
        set.push({
          txid: tx.txid,
          blockhash: tx.blockhash,
          blockheight: tx.blockheight,
          blocktime: tx.blocktime
        });
      });
      return daemon.db.set('addr-tx/' + address, set, function() {
        return callback(null, addr);
      });
    });
  });
};

Daemon.prototype.getBestBlock = function(callback) {
  if (daemon.stopping) return [];
  var hash = bitcoindjs.getBestBlock();
  return bitcoindjs.getBlock(hash, callback);
};

Daemon.prototype.getChainHeight = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getChainHeight();
};

Daemon.prototype.__defineGetter__('chainHeight', function() {
  if (daemon.stopping) return [];
  return this.getChainHeight();
});

Daemon.prototype.getBlockByTxid =
Daemon.prototype.getBlockByTx = function(txid, callback) {
  if (daemon.stopping) return [];
  return daemon.db.get('block-tx/' + txid, function(err, block) {
    if (block) {
      return self.getBlock(block.hash, function(err, block) {
        if (err) return callback(err);
        var tx_ = block.tx.filter(function(tx) {
          return tx.txid === txid;
        })[0];
        return callback(null, block, tx_);
      });
    }
    return bitcoindjs.getBlockByTx(txid, function(err, block, tx_) {
      if (err) return callback(err);
      daemon.db.set('block-tx/' + txid, { hash: block.hash }, utils.NOOP);
      return callback(null, daemon.block(block), daemon.tx(tx_));
    });
  });
};

Daemon.prototype.getBlocksByDate =
Daemon.prototype.getBlocksByTime = function(options, callback) {
  if (daemon.stopping) return [];
  return bitcoindjs.getBlocksByTime(options, function(err, blocks) {
    if (err) return callback(err);
    return callback(null, blocks.map(function(block) {
      return daemon.block(block);
    }));
  });
};

Daemon.prototype.getFromTx = function(txid, callback) {
  if (daemon.stopping) return [];
  return bitcoindjs.getFromTx(txid, function(err, txs) {
    if (err) return callback(err);
    return callback(null, txs.map(function(tx) {
      return daemon.tx(tx)
    }));
  });
};

Daemon.prototype.getLastFileIndex = function() {
  if (daemon.stopping) return [];
  return bitcoindjs.getLastFileIndex();
};

Daemon.prototype.log =
Daemon.prototype.info = function() {
  if (daemon.stopping) return [];
  if (this.options.silent) return;
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stdout.write('bitcoind.js: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stdout.write('bitcoind.js: ' + out + '\n');
};

Daemon.prototype.error = function() {
  if (daemon.stopping) return [];
  if (this.options.silent) return;
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stderr.write('bitcoind.js: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stderr.write('bitcoind.js: ' + out + '\n');
};

Daemon.prototype.stop =
Daemon.prototype.close = function(callback) {
  if (daemon.stopping) return [];
  var self = this;
  return bitcoindjs.stop(function(err, status) {
    if (err) {
      self.error(err.message);
    } else {
      self.log(status);
    }
    if (!callback) return;
    return callback(err, status);
  });
};

Daemon.prototype.__defineGetter__('stopping', function() {
  return bitcoindjs.stopping() || bitcoindjs.stopped();
});

Daemon.prototype.__defineGetter__('stopped', function() {
  return bitcoindjs.stopped();
});

Daemon.__defineGetter__('stopping', function() {
  return bitcoindjs.stopping() || bitcoindjs.stopped();
});

Daemon.__defineGetter__('stopped', function() {
  return bitcoindjs.stopped();
});

/**
 * Block
 */

function Block(data) {
  if (!(this instanceof Block)) {
    return new Block(data);
  }

  if (typeof data === 'string') {
    return Block.fromHex(data);
  }

  if (data instanceof Block) {
    return data;
  }

  if (daemon.stopping) return [];

  var self = this;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });

  this.tx = this.tx.map(function(tx) {
    return daemon.tx(tx);
  });

  if (!this.hex) {
    this.hex = this.toHex();
  }
}

Object.defineProperty(Block.prototype, '_blockFlag', {
  __proto__: null,
  configurable: false,
  enumerable: false,
  writable: false,
  value: {}
});

Block.isBlock = function(block) {
  if (daemon.stopping) return [];
  return block._blockFlag === Block.prototype._blockFlag;
};

Block.fromHex = function(hex) {
  if (daemon.stopping) return [];
  return daemon.block(bitcoindjs.blockFromHex(hex));
};

Block.prototype.getHash = function(enc) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getBlockHex(this);
  if (!this.hash || this.hash !== data.hash) {
    this.hash = data.hash;
  }
  if (enc === 'hex') return data.hash;
  var buf = new Buffer(data.hash, 'hex');
  var out = enc ? buf.toString(enc) : buf;
  return out;
};

Block.prototype.verify = function() {
  if (daemon.stopping) return [];
  return this.verified = this.verified || bitcoindjs.verifyBlock(this);
};

Block.prototype.toHex = function() {
  if (daemon.stopping) return [];
  var hex = Block.toHex(this);
  if (!this.hex || this.hex !== hex) {
    this.hex = hex;
  }
  return hex;
};

Block.toHex = function(block) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getBlockHex(block);
  return data.hex;
};

Block.prototype.toBinary = function() {
  if (daemon.stopping) return [];
  return Block.toBinary(this);
};

Block.toBinary = function(block) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getBlockHex(block);
  return new Buffer(data.hex, 'hex');
};

/**
 * Transaction
 */

function Transaction(data) {
  if (!(this instanceof Transaction)) {
    return new Transaction(data);
  }

  if (typeof data === 'string') {
    return Transaction.fromHex(data);
  }

  if (data instanceof Transaction) {
    return data;
  }

  if (daemon.stopping) return [];

  var self = this;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });

  if (!this.hex) {
    this.hex = this.toHex();
  }
}

Object.defineProperty(Transaction.prototype, '_txFlag', {
  __proto__: null,
  configurable: false,
  enumerable: false,
  writable: false,
  value: {}
});

Transaction.isTransaction =
Transaction.isTx = function(tx) {
  if (daemon.stopping) return [];
  return tx._txFlag === Transaction.prototype._txFlag;
};

Transaction.fromHex = function(hex) {
  if (daemon.stopping) return [];
  return daemon.tx(bitcoindjs.txFromHex(hex));
};

Transaction.prototype.verify = function() {
  if (daemon.stopping) return [];
  return this.verified = this.verified || bitcoindjs.verifyTransaction(this);
};

Transaction.prototype.sign =
Transaction.prototype.fill = function(options) {
  if (daemon.stopping) return [];
  return Transaction.fill(this, options);
};

Transaction.sign =
Transaction.fill = function(tx, options) {
  if (daemon.stopping) return [];
  var isTx = daemon.tx.isTx(tx)
    , newTx;

  if (!isTx) {
    tx = daemon.tx(tx);
  }

  try {
    newTx = bitcoindjs.fillTransaction(tx, options || {});
  } catch (e) {
    return false;
  }

  Object.keys(newTx).forEach(function(key) {
    tx[key] = newTx[key];
  });

  return tx;
};

Transaction.prototype.getHash = function(enc) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getTxHex(this);
  if (!this.txid || this.txid !== data.hash) {
    this.txid = data.hash;
  }
  if (enc === 'hex') return data.hash;
  var buf = new Buffer(data.hash, 'hex');
  var out = enc ? buf.toString(enc) : buf;
  return out;
};

Transaction.prototype.isCoinbase = function() {
  if (daemon.stopping) return [];
  return this.vin.length === 1 && this.vin[0].coinbase;
};

Transaction.prototype.toHex = function() {
  if (daemon.stopping) return [];
  var hex = Transaction.toHex(this);
  if (!this.hex || hex !== this.hex) {
    this.hex = hex;
  }
  return hex;
};

Transaction.toHex = function(tx) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getTxHex(tx);
  return data.hex;
};

Transaction.prototype.toBinary = function() {
  if (daemon.stopping) return [];
  return Transaction.toBinary(this);
};

Transaction.toBinary = function(tx) {
  if (daemon.stopping) return [];
  var data = bitcoindjs.getTxHex(tx);
  return new Buffer(data.hex, 'hex');
};

Transaction.broadcast = function(tx, options, callback) {
  if (daemon.stopping) return [];
  if (typeof tx === 'string') {
    tx = { hex: tx };
  }

  if (!callback) {
    callback = options;
    options = null;
  }

  if (!options) {
    options = {};
  }

  var fee = options.overrideFees = options.overrideFees || false;
  var own = options.ownOnly = options.ownOnly || false;

  if (!callback) {
    callback = utils.NOOP;
  }

  if (!daemon.isTx(tx)) {
    tx = daemon.tx(tx);
  }

  return bitcoindjs.broadcastTx(tx, fee, own, function(err, hash, tx) {
    if (err) {
      if (callback === utils.NOOP) {
        daemon.global.emit('error', err);
      }
      return callback(err);
    }
    tx = daemon.tx(tx);
    daemon.global.emit('broadcast', tx);
    return callback(null, hash, tx);
  });
};

Transaction.prototype.broadcast = function(options, callback) {
  if (daemon.stopping) return [];
  if (!callback) {
    callback = options;
    options = null;
  }
  return Transaction.broadcast(this, options, callback);
};

/**
 * Addresses
 */

function Addresses(data) {
  if (!(this instanceof Addresses)) {
    return new Addresses(data);
  }

  if (data instanceof Addresses) {
    return data;
  }

  if (daemon.stopping) return [];

  var self = this;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });
}

Object.defineProperty(Transaction.prototype, '_addrFlag', {
  __proto__: null,
  configurable: false,
  enumerable: false,
  writable: false,
  value: {}
});

Addresses.isAddresses =
Addresses.isAddr = function(addr) {
  if (daemon.stopping) return [];
  return addr._txFlag === Addresses.prototype._addrFlag;
};

/**
 * Utils
 */

var utils = {};

utils.forEach = function(obj, iter, done) {
  if (daemon.stopping) return [];
  var pending = obj.length;
  if (!pending) return done();
  var next = function() {
    if (!--pending) done();
  };
  obj.forEach(function(item) {
    iter(item, next);
  });
};

utils.NOOP = function() {};

/**
 * Expose
 */

module.exports = exports = daemon;

exports.Daemon = daemon;
exports.daemon = daemon;
exports.bitcoind = daemon;

exports.native = bitcoindjs;
exports.bitcoindjs = bitcoindjs;

exports.Block = Block;
exports.block = Block;

exports.Transaction = Transaction;
exports.transaction = Transaction;
exports.tx = Transaction;

exports.Addresses = Addresses;
exports.addresses = Addresses;
exports.addr = Addresses;

exports.utils = utils;
