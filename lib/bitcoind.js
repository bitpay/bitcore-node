/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 * A bitcoind node.js binding.
 */

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('../build/Release/bitcoindjs.node');
var util = require('util');
var fs = require('fs');
var mkdirp = require('mkdirp');

/**
 * Bitcoin
 */

var bitcoin = Bitcoin;

function Bitcoin(options) {
  var self = this;

  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  if (Object.keys(this.instances).length) {
    throw new
      Error('bitcoind.js cannot be instantiated more than once.');
  }

  EventEmitter.call(this);

  this.options = options || {};
  this.wallet = Wallet;

  if (typeof this.options === 'string') {
    this.options = { datadir: this.options };
  }

  if (this.options.directory) {
    this.options.datadir = this.options.directory;
    delete this.options.directory;
  }

  if (!this.options.datadir) {
    this.options.datadir = process.env.HOME + '/.bitcoin';
  }

  this.options.datadir = this.options.datadir.replace(/^~/, process.env.HOME);

  this.config = this.options.datadir + '/bitcoin.conf';

  if (!fs.existsSync(this.options.datadir)) {
    mkdirp.sync(this.options.datadir);
  }

  if (!fs.existsSync(this.config)) {
    var password = ''
      + Math.random().toString(36).slice(2)
      + Math.random().toString(36).slice(2)
      + Math.random().toString(36).slice(2);
    fs.writeFileSync(this.config, ''
      + 'rpcuser=bitcoinrpc\n'
      + 'rpcpassword=' + password + '\n'
    );
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

Bitcoin.prototype.__proto__ = EventEmitter.prototype;

// Make sure signal handlers are not overwritten
Bitcoin._signalQueue = [];
Bitcoin._processOn = process.on;
process.addListener =
process.on = function(name, listener) {
  if (~['SIGINT', 'SIGHUP', 'SIGQUIT'].indexOf(name.toUpperCase())) {
    if (!Bitcoin.global || !Bitcoin.global._started) {
      Bitcoin._signalQueue.push([name, listener]);
      return;
    }
  }
  return Bitcoin._processOn.apply(this, arguments);
};

Bitcoin.instances = {};
Bitcoin.prototype.instances = Bitcoin.instances;

Bitcoin.__defineGetter__('global', function() {
  return Bitcoin.instances[Object.keys(Bitcoin.instances)[0]];
});

Bitcoin.prototype.start = function(options, callback) {
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

  if (this.instances[this.options.datadir]) {
    return;
  }
  this.instances[this.options.datadir] = true;

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

  this.log_pipe = bitcoindjs.start(options, function(err, status) {
    self._started = true;

    // Poll for queued packets
    setInterval(function() {
      var packets = bitcoindjs.hookPackets();

      if (!packets) {
        if (self.debug) {
          bitcoind.error('Error polling packet queue.');
        }
        return;
      }

      if (!packets.length) {
        return;
      }

      self.emit('packets', packets);

      packets.forEach(function(packet) {
        setImmediate(function() {
          self.emit('packet:' + packet.name, packet);
          self.emit('packet', packet);
          // if (packet.name === 'block' || packet.name === 'tx') {
          //   self.emit(packet.name, packet.block || packet.tx);
          //   if (packet.tx && !packet.tx.blockhash) {
          //     self.emit('mptx', packet.tx);
          //   }
          // }
        });
      });
    }, 50);

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
    process.on = process.addListener = Bitcoin._processOn;
    Bitcoin._signalQueue.forEach(function(event) {
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

    setTimeout(function callee() {
      // Wait until wallet is loaded:
      if (!Object.keys(self.wallet.listAccounts()).length) {
        return setTimeout(callee, 100);
      }

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

  this.pollInterval = 300;

  this._emitted = {};

  this.on('newListener', function(name) {
    if (name === 'version' || name === 'peer') {
      self._pollPeers();
      return;
    }
    if (name === 'addr') {
      self._pollAddresses();
      return;
    }
    if (name === 'block') {
      self._pollBlocks();
      return;
    }
    if (name === 'tx') {
      self._pollBlocks();
      self._pollMempool();
      return;
    }
    if (name === 'mptx') {
      self._pollMempool();
      return;
    }
  });

  if (this.log_pipe !== -1) {
    this.log('log pipe opened: %d', this.log_pipe);
    this._pipe = new net.Socket(this.log_pipe);
    this._pipe.on('data', function(data) {
      return process.stdout.write('bitcoind.js: ' + data + '\n');
    });
    this._pipe.on('error', function(err) {
      ; // ignore for now
    });
    this._pipe.resume();
  }
};

Bitcoin.prototype._pollBlocks = function() {
  var self = this;
  if (this._pollingBlocks) return;
  this._pollingBlocks = true;
  (function next() {
    return bitcoindjs.pollBlocks(function(err, blocks) {
      if (err) {
        if (self.debug) {
          console.log('poll error:');
          console.log(err.message);
        }
        return setTimeout(next, self.pollInterval);
      }
      return utils.forEach(blocks, function(block, nextBlock) {
        block = bitcoin.block(block);

        // XXX Bad workaround
        if (self._emitted[block.hash]) {
          if (Object.keys(self._emitted[block.hash]).length > 10000) {
            self._emitted = {};
          }
          return setImmediate(function() {
            return nextBlock();
          });
        }
        self._emitted[block.hash] = true;

        self.emit('block', block);

        if (!self._pollingTxs) {
          return setImmediate(function() {
            return nextBlock();
          });
        }

        return utils.forEach(block.tx, function(tx, nextTx) {
          tx = bitcoin.tx(tx);
          self.emit('tx', tx);
          return setImmediate(function() {
            return nextTx();
          });
        }, function() {
          return setImmediate(function() {
            return nextBlock();
          });
        });
      }, function() {
        if (self.debug) {
          console.log('emission finished');
        }
        return setTimeout(next, self.pollInterval);
      });
    });
  })();
};

Bitcoin.prototype._pollMempool = function() {
  var self = this;
  if (this._pollingTxs) return;
  this._pollingTxs = true;
  (function next() {
    return bitcoindjs.pollMempool(function(err, txs) {
      if (err) return setTimeout(next, self.pollInterval);
      return utils.forEach(txs, function(tx, nextTx) {
        tx = bitcoin.tx(tx);

        // XXX Bad workaround
        if (self._emitted[tx.txid]) {
          if (Object.keys(self._emitted[block.hash]).length > 10000) {
            self._emitted = {};
          }
          return setImmediate(function() {
            return nextTx();
          });
        }
        self._emitted[tx.txid] = true;

        self.emit('mptx', tx);
        self.emit('tx', tx);

        return setImmediate(function() {
          return nextTx();
        });
      }, function() {
        return setTimeout(next, self.pollInterval);
      });
    });
  })();
};

// XXX Not perfect - will not catch all version packets.
Bitcoin.prototype._pollPeers = function() {
  var self = this;
  if (this._pollingPeers) return;
  this._pollingPeers = true;
  var lastPeers = bitcoindjs.getPeerInfo();
  (function next() {
    var peers = bitcoindjs.getPeerInfo();
    peers = peers.filter(function(peer, i) {
      return !lastPeers[i] || peer.addr !== lastPeers[i].addr;
    });
    peers.forEach(function(peer) {
      self.emit('peer', peer);
      self.emit('version', {
        version: peer.version,
        services: peer.services,
        time: peer.conntime,
        nonce: null,
        useragent: peer.subver,
        startheight: peer.startingheight,
        relay: null // peer.fRelayTxes
      });
    });
    lastPeers = peers;
    return setTimeout(next, self.pollInterval);
  })();
};

Bitcoin.prototype._pollAddresses = function() {
  var self = this;
  if (this._pollingAddresses) return;
  this._pollingAddresses = true;
  var lastAddrs = bitcoindjs.getAddresses();
  (function next() {
    var addrs = bitcoindjs.getAddresses();
    addrs = addrs.filter(function(addr, i) {
      return !lastAddrs[i] || addr.time !== lastAddrs[i].time;
    });
    addrs.forEach(function(addr) {
      self.emit('addr',  {
        services: addr.services,
        time: addr.time,
        last: addr.last,
        ip: addr.ip,
        port: addr.port,
        address: addr.address
      });
    });
    lastAddrs = addrs;
    return setTimeout(next, self.pollInterval);
  })();
};

Bitcoin.prototype.getBlock = function(blockHash, callback) {
  return bitcoindjs.getBlock(blockHash, function(err, block) {
    if (err) return callback(err);
    return callback(null, bitcoin.block(block));
  });
};

Bitcoin.prototype.getTx = function(txHash, blockHash, callback) {
  if (!callback) {
    callback = blockHash;
    blockHash = '';
  }
  return bitcoindjs.getTx(txHash, blockHash, function(err, tx) {
    if (err) return callback(err);
    return callback(null, bitcoin.tx(tx));
  });
};

Bitcoin.prototype.getInfo = function() {
  return bitcoindjs.getInfo();
};

Bitcoin.prototype.getPeerInfo = function() {
  return bitcoindjs.getPeerInfo();
};

Bitcoin.prototype.getAddresses = function() {
  return bitcoindjs.getAddresses();
};

Bitcoin.prototype.log =
Bitcoin.prototype.info = function() {
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stdout.write('bitcoind.js: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stdout.write('bitcoind.js: ' + out + '\n');
};

Bitcoin.prototype.error = function() {
  if (typeof arguments[0] !== 'string') {
    var out = util.inspect(arguments[0], null, 20, true);
    return process.stderr.write('bitcoind.js: ' + out + '\n');
  }
  var out = util.format.apply(util, arguments);
  return process.stderr.write('bitcoind.js: ' + out + '\n');
};

Bitcoin.prototype.stop =
Bitcoin.prototype.close = function(callback) {
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

/**
 * Block
 */

function Block(data) {
  if (!(this instanceof Block)) {
    return new Block(data);
  }

  if (data instanceof Block) {
    return data;
  }

  var self = this;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });

  this.tx = this.tx.map(function(tx) {
    return bitcoin.tx(tx);
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
  return block._blockFlag === Block.prototype._blockFlag;
};

Block.fromHex = function(hex) {
  return bitcoin.block(bitcoindjs.blockFromHex(hex));
};

Block.prototype.getHash = function(enc) {
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
  return this.verified = this.verified || bitcoindjs.verifyBlock(this);
};

Block.prototype.toHex = function() {
  var hex = Block.toHex(this);
  if (!this.hex || this.hex !== hex) {
    this.hex = hex;
  }
  return hex;
};

Block.toHex = function(block) {
  var data = bitcoindjs.getBlockHex(block);
  return data.hex;
};

Block.prototype.toBinary = function() {
  return Block.toBinary(this);
};

Block.toBinary = function(block) {
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

  if (data instanceof Transaction) {
    return data;
  }

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
  return tx._txFlag === Transaction.prototype._txFlag;
};

Transaction.fromHex = function(hex) {
  return bitcoin.tx(bitcoindjs.txFromHex(hex));
};

Transaction.prototype.verify = function() {
  return this.verified = this.verified || bitcoindjs.verifyTransaction(this);
};

Transaction.prototype.sign =
Transaction.prototype.fill = function(options) {
  return Transaction.fill(this, options);
};

Transaction.sign =
Transaction.fill = function(tx, options) {
  var isTx = bitcoin.tx.isTx(tx)
    , newTx;

  if (!isTx) {
    tx = bitcoin.tx(tx);
  }

  try {
    newTx = bitcoindjs.fillTransaction(tx, options || {});
  } catch (e) {
    return false;
  }

  Object.keys(newTx).forEach(function(key) {
    tx[key] = newTx[key];
  });

  return isTx ? true : tx;
};

Transaction.prototype.getHash = function(enc) {
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
  return this.vin.length === 1 && this.vin[0].coinbase;
};

Transaction.prototype.toHex = function() {
  var hex = Transaction.toHex(this);
  if (!this.hex || hex !== this.hex) {
    this.hex = hex;
  }
  return hex;
};

Transaction.toHex = function(tx) {
  var data = bitcoindjs.getTxHex(tx);
  return data.hex;
};

Transaction.prototype.toBinary = function() {
  return Transaction.toBinary(this);
};

Transaction.toBinary = function(tx) {
  var data = bitcoindjs.getTxHex(tx);
  return new Buffer(data.hex, 'hex');
};

Transaction.broadcast = function(tx, options, callback) {
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

  if (!bitcoin.isTx(tx)) {
    tx = bitcoin.tx(tx);
  }

  return bitcoindjs.broadcastTx(tx, fee, own, function(err, hash, tx) {
    if (err) {
      if (callback === utils.NOOP) {
        bitcoin.global.emit('error', err);
      }
      return callback(err);
    }
    tx = bitcoin.tx(tx);
    bitcoin.global.emit('broadcast', tx);
    return callback(null, hash, tx);
  });
};

Transaction.prototype.broadcast = function(options, callback) {
  if (!callback) {
    callback = options;
    options = null;
  }
  return Transaction.broadcast(this, options, callback);
};

/**
 * Wallet
 * Singleton
 */

function Wallet() {
  var obj = function() {
    return obj;
  };
  Object.keys(Wallet.prototype).forEach(function(key) {
    obj[key] = Wallet.prototype[key];
  });
  return obj;
}

Wallet.prototype.createAddress = function(options) {
  return bitcoindjs.walletNewAddress(options || {});
};

Wallet.prototype.getAccountAddress = function(options) {
  return bitcoindjs.walletGetAccountAddress(options || {});
};

Wallet.prototype.setAccount = function(options) {
  return bitcoindjs.walletSetAccount(options || {});
};

Wallet.prototype.getAccount = function(options) {
  return bitcoindjs.walletGetAccount(options || {});
};

Wallet.prototype.sendTo = function(options) {
  return bitcoindjs.walletSendTo(options || {});
};

Wallet.prototype.signMessage = function(options) {
  return bitcoindjs.walletSignMessage(options || {});
};

Wallet.prototype.verifyMessage = function(options) {
  return bitcoindjs.walletVerifyMessage(options || {});
};

Wallet.prototype.createMultiSigAddress = function(options) {
  return bitcoindjs.walletCreateMultiSigAddress(options || {});
};

Wallet.prototype.getBalance = function(options) {
  return bitcoindjs.walletGetBalance(options || {});
};

Wallet.prototype.getUnconfirmedBalance = function(options) {
  return bitcoindjs.walletGetUnconfirmedBalance(options || {});
};

Wallet.prototype.sendFrom = function(options) {
  return bitcoindjs.walletSendFrom(options || {});
};

Wallet.prototype.listTransactions = function(options) {
  return bitcoindjs.walletListTransactions(options || {});
};

Wallet.prototype.listAccounts = function(options) {
  return bitcoindjs.walletListAccounts(options || {});
};

Wallet.prototype.getTransaction = function(options) {
  return bitcoindjs.walletGetTransaction(options || {});
};

Wallet.prototype.backup = function(options) {
  return bitcoindjs.walletBackup(options || {});
};

Wallet.prototype.decrypt =
Wallet.prototype.passphrase = function(options) {
  return bitcoindjs.walletPassphrase(options || {});
};

Wallet.prototype.passphraseChange = function(options) {
  return bitcoindjs.walletPassphraseChange(options || {});
};

Wallet.prototype.forgetPassphrase =
Wallet.prototype.lock = function(options) {
  return bitcoindjs.walletLock(options || {});
};

Wallet.prototype.encrypt = function(options) {
  return bitcoindjs.walletEncrypt(options || {});
};

Wallet.prototype.setTxFee = function(options) {
  return bitcoindjs.walletSetTxFee(options || {});
};

Wallet.prototype.importKey = function(options) {
  return bitcoindjs.walletImportKey(options || {});
};

Wallet = new Wallet;

/**
 * Utils
 */

var utils = {};

utils.forEach = function(obj, iter, done) {
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

module.exports = exports = bitcoin;

exports.Bitcoin = bitcoin;
exports.bitcoin = bitcoin;
exports.bitcoind = bitcoin;

exports.native = bitcoindjs;
exports.bitcoindjs = bitcoindjs;

exports.Block = Block;
exports.block = Block;

exports.Transaction = Transaction;
exports.transaction = Transaction;
exports.tx = Transaction;

exports.Wallet = Wallet;
exports.wallet = Wallet;

exports.utils = utils;
