/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 * A bitcoind node.js binding.
 */

var net = require('net');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('../build/Release/bitcoindjs.node');
var util = require('util');
var net = require('net');
var assert = require('assert');
var bn = require('bn.js');

/**
 * Bitcoin
 */

var bitcoin = Bitcoin;

function Bitcoin(options) {
  var self = this;

  if (Bitcoin.global) {
    throw new Error('bitcoindjs cannot be instantiated more than once.');
  }

  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  EventEmitter.call(this);

  this.options = options;
  this.wallet = Wallet;

  Bitcoin.global = this;

  this.on('newListener', function(name) {
    if (name === 'open') {
      self.start();
    }
  });
}

Bitcoin.prototype.__proto__ = EventEmitter.prototype;

Bitcoin.prototype.start = function(callback) {
  var self = this;

  if (this._started) return;
  this._started = true;

  var none = {};
  var isSignal = {};
  var sigint = { name: 'SIGINT', signal: isSignal };
  var sighup = { name: 'SIGHUP', signal: isSignal };
  var sigquit = { name: 'SIGQUIT', signal: isSignal };
  var exitCaught = none;
  var errorCaught = none;

  this.log_pipe = bitcoindjs.start(function(err, status) {
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

    if (callback) {
      callback(err);
      callback = null;
    }

    if (err) {
      self.emit('error', err);
    } else {
      self.emit('open', status);
    }
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
      if (err) return setTimeout(next, self.pollInterval);
      return utils.forEach(blocks, function(block, nextBlock) {
        block = bitcoin.block(block);

        // XXX Bad workaround
        if (self._emitted[block.hash]) {
          return setImmediate(function() {
            return nextBlock();
          });
        }
        self._emitted[block.hash] = true;

        self.emit('block', block);

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
        return setTimeout(next, self.pollInterval);
      });
    });
  })();
};

Bitcoin.prototype._pollMempool = function() {
  var self = this;
  if (this._pollingMempool) return;
  this._pollingMempool = true;
  (function next() {
    return bitcoindjs.pollMempool(function(err, txs) {
      if (err) return setTimeout(next, self.pollInterval);
      return utils.forEach(txs, function(tx, nextTx) {
        tx = bitcoin.tx(tx);

        // XXX Bad workaround
        if (self._emitted[tx.hash]) {
          return setImmediate(function() {
            return nextTx();
          });
        }
        self._emitted[tx.hash] = true;

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

var _blockFlag = {};

function Block(data) {
  if (!(this instanceof Block)) {
    return new Block(data);
  }

  if (data instanceof Block) {
    return data;
  }

  var self = this;

  this._blockFlag = _blockFlag;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });

  this.vMerkleTree = data.merkletree || data.vMerkleTree;

  this.toHex();
}

Block.isBlock = function(block) {
  return block._blockFlag === _blockFlag;
};

// NOTE: Could just call tx.GetHash().ToString() in C++
Block.prototype.hash =
Block.prototype.getHash = function(enc) {
  if (!this._hash) {
    this._hash = utils.dsha256(this.rawHeader(), 'hex');
  }
  return enc === 'hex'
    ? this._hash
    : utils.dsha256(this.rawHeader());
};

Block.prototype.rawHeader = function() {
  var res = new Array(80);

  utils.writeU32(res, this.version, 0);
  utils.copy(utils.toArray(this.previousblockhash, 'hex'), res, 4);
  utils.copy(utils.toArray(this.merkleroot, 'hex'), res, 36);
  utils.writeU32(res, this.time, 68);
  utils.writeU32(res, this.bits, 72);
  utils.writeU32(res, this.nonce, 76);

  return new Buffer(res);
};

Block.prototype.verify = function() {
  return this.verified = this.verified || bitcoindjs.verifyBlock(this);
};

Block.prototype.toBinary = function() {
  return Block.toBinary(this);
};

Block.toBinary = function(block, type) {
  var p = [];
  var off = 0;

  // version
  off += utils.writeU32(p, block.nVersion || block.version, off);

  // prev_block
  utils.toArray(block.previousblockhash, 'hex').forEach(function(ch) {
    p[off++] = ch;
  });

  // merkle_root
  utils.toArray(block.merkleroot, 'hex').forEach(function(ch) {
    p[off++] = ch;
  });

  // timestamp
  off += utils.writeU32(p, block.time, off);

  // bits
  off += utils.writeU32(p, block.bits, off);

  // nonce
  off += utils.writeU32(p, block.nonce, off);

  assert.equal(off, 80);

  if (type === 'merkle') {
    // txn_count
    off += utils.writeU32(p, block.txn_count, off);
    // hash count
    off += utils.varint(p, block.hash_count, off);
    // hashes
    block.hashes.forEach(function(hash) {
      utils.toArray(hash, 'hex').forEach(function(ch) {
        p[off++] = ch;
      });
    });
    // flag count
    off += utils.varint(p, block.flags.length, off);
    // flags
    block.flags.forEach(function(flag) {
      p[off++] = flag;
    });
  } else {
    // txn_count
    off += utils.varint(p, block.tx.length, off);
    // txs
    block.tx.forEach(function(tx) {
      tx = bitcoin.tx(tx);
      tx.toHex();
      utils.toArray(tx.hex, 'hex').forEach(function(ch) {
        p[off++] = ch;
      });
    });
  }

  return new Buffer(p);
};

Block.prototype.toHex = function() {
  return this.hex = this.hex || Block.toHex(this);
};

Block.toHex = function(block) {
  return Block.toBinary(block).toString('hex');
};

/**
 * Transaction
 */

var _txFlag = {};

function Transaction(data) {
  if (!(this instanceof Transaction)) {
    return new Transaction(data);
  }

  if (data instanceof Transaction) {
    return data;
  }

  var self = this;

  this._txFlag = _txFlag;

  this.nMinTxFee = data.nMinTxFee || data.minTxFee || 1000;
  this.nMinRelayTxFee = data.nMinRelayTxFee || data.minRelayTxFee || 1000;
  this.CURRENT_VERSION = 1;
  this.nVersion = data.nVersion || data.version || this.CURRENT_VERSION;
  this.vin = data.vin || [];
  this.vout = data.vout || [];
  this.nLockTime = data.nLockTime || data.locktime || 0;

  Object.keys(data).forEach(function(key) {
    if (!self[key]) {
      self[key] = data[key];
    }
  });

  if (this.isCoinbase()) {
    this.vin[0].txid = Array(64 + 1).join('0');
    this.vin[0].vout = 0;
    this.vin[0].scriptSig = {
      asm: null,
      hex: this.vin[0].coinbase
    };
  }

  this.toHex();
}

Transaction.isTransaction =
Transaction.isTx = function(tx) {
  return tx._txFlag === _txFlag;
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

// NOTE: Could just call tx.GetHash().ToString() in C++
Transaction.prototype.hash =
Transaction.prototype.getHash = function(enc) {
  if (!this._hash) {
    this._hash = utils.dsha256(this.toBinary(), 'hex');
  }
  return enc === 'hex'
    ? this._hash
    : utils.dsha256(this.toBinary());
};

Transaction.prototype.isCoinbase = function() {
  return this.vin.length === 1 && this.vin[0].coinbase;
};

Transaction.prototype.toHex = function() {
  return this.hex = this.hex || Transaction.toHex(this);
};

Transaction.toHex = function(tx) {
  return Transaction.toBinary(tx).toString('hex');
};

Transaction.toBinary = function(tx) {
  var p = [];
  var off = utils.writeU32(p, tx.nVersion || tx.version, 0);
  off += utils.varint(p, tx.vin.length, off);

  for (var i = 0; i < tx.vin.length; i++) {
    var input = tx.vin[i];

    if (input.coinbase) {
      off += utils.copy(new bn(Array(64 + 1).join('0'), 'hex').toArray(), p, off, true);
      off += utils.writeU32(p, 0, off);

      var s = script.encode(new bn(input.coinbase, 'hex').toArray());
      off += utils.varint(p, s.length, off);
      off += utils.copy(s, p, off, true);

      off += utils.writeU32(p, input.sequence, off);
    } else {
      off += utils.copy(new bn(input.txid, 'hex').toArray(), p, off, true);
      off += utils.writeU32(p, input.vout, off);

      var s = script.encode(new bn(input.scriptSig.hex, 'hex').toArray());
      off += utils.varint(p, s.length, off);
      off += utils.copy(s, p, off, true);

      off += utils.writeU32(p, input.sequence, off);
    }
  }

  off += utils.varint(p, tx.vout.length, off);
  for (var i = 0; i < tx.vout.length; i++) {
    var output = tx.vout[i];

    // Put LE value
    var value = new bn(output.value).toArray().slice().reverse();
    assert(value.length <= 8);
    off += utils.copy(value, p, off, true);
    for (var j = value.length; j < 8; j++, off++) {
      p[off] = 0;
    }

    var s = script.encode(new bn(output.scriptPubKey.hex, 'hex').toArray());
    off += utils.varint(p, s.length, off);
    off += utils.copy(s, p, off, true);
  }
  off += utils.writeU32(p, tx.nLockTime || tx.locktime, off);

  return new Buffer(p);
};

Transaction.prototype.toBinary = function() {
  return Transaction.toBinary(this);
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

  if (!tx.hex) {
    tx = bitcoin.tx(tx);
    tx.toHex();
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
 * Script
 */

var script = {};

script.encode = function encode(s) {
  if (!s) {
    return [];
  }

  var res = [];
  for (var i = 0; i < s.length; i++) {
    var instr = s[i];

    // Push value to stack
    if (Array.isArray(instr)) {
      if (instr.length === 0) {
        res.push(0);
      } else if (instr.length === 1 && 0 < instr[0] && instr[0] <= 16) {
        res.push(0x50 + instr[0]);
      } else if (1 <= instr.length && instr.length <= 0x4b) {
        res = res.concat(instr.length, instr);
      } else if (instr.length <= 0xff) {
        res = res.concat(0x4c, instr.length, instr);
      } else if (instr.length <= 0xffff) {
        res.push(0x4d);
        utils.writeU16(res, instr.length, res.length);
        res = res.concat(instr);
      } else {
        res.push(0x4e);
        utils.writeU32(res, instr.length, res.length);
        res = res.concat(instr);
      }
      continue;
    }

    res.push(instr);
  }

  return res;
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

Wallet = new Wallet;

/**
 * Utils
 */

var utils = {};

utils.revHex = function revHex(s) {
  var r = '';
  for (var i = 0; i < s.length; i += 2) {
    r = s.slice(i, i + 2) + r;
  }
  return r;
};

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

utils.writeU16 = function writeU16(dst, num, off) {
  if (!off)
    off = 0;
  dst[off] = num & 0xff;
  dst[off + 1] = (num >>> 8) & 0xff;
  return 2;
};

utils.writeU32 = function writeU32(dst, num, off) {
  if (!off)
    off = 0;
  dst[off] = num & 0xff;
  dst[off + 1] = (num >>> 8) & 0xff;
  dst[off + 2] = (num >>> 16) & 0xff;
  dst[off + 3] = (num >>> 24) & 0xff;
  return 4;
};

utils.varint = function(arr, value, off) {
  if (!off)
    off = 0;
  if (value < 0xfd) {
    arr[off] = value;
    return 1;
  } else if (value <= 0xffff) {
    arr[off] = 0xfd;
    arr[off + 1] = value & 0xff;
    arr[off + 2] = value >>> 8;
    return 3;
  } else if (value <= 0xffffffff) {
    arr[off] = 0xfe;
    arr[off + 1] = value & 0xff;
    arr[off + 2] = (value >>> 8) & 0xff;
    arr[off + 3] = (value >>> 16) & 0xff;
    arr[off + 4] = value >>> 24;
    return 5;
  } else {
    arr[off] = 0xff;
    utils.writeU64(arr, value, off + 1);
    return 9;
  }
};

utils.ripesha = function(data, enc) {
  return utils.ripemd160(utils.sha256(data, enc));
};

utils.checksum = function(data, enc) {
  var b = new Buffer(utils.toArray(utils.dsha256(data, enc)).slice(0, 4));
  return enc ? b.toString(enc) : b;
};

utils.dsha256 = function(data, enc) {
  return utils.sha256(utils.sha256(data, enc));
};

utils._hash = function(algo, data, enc) {
  var hash = crypto.createHash(algo);
  hash.update(data);
  return hash.digest(enc);
};

utils.sha256 = function(data, enc) {
  return utils._hash('sha256', data, enc);
};

utils.ripemd160 = function(data, enc) {
  return utils._hash('ripemd160', data, enc);
};

utils.copy = function copy(src, dst, off, force) {
  var len = src.length;
  if (!force)
    len = Math.min(dst.length - off, len);
  for (var i = 0; i < len; i++)
    dst[i + off] = src[i];
  return i;
};

function toArray(msg, enc) {
  if (Buffer.isBuffer(msg))
    return Array.prototype.slice.call(msg);
  if (Array.isArray(msg))
    return msg.slice();
  if (!msg)
    return [];
  var res = [];
  if (typeof msg === 'string') {
    if (!enc) {
      for (var i = 0; i < msg.length; i++) {
        var c = msg.charCodeAt(i);
        var hi = c >> 8;
        var lo = c & 0xff;
        if (hi)
          res.push(hi, lo);
        else
          res.push(lo);
      }
    } else if (enc === 'hex') {
      msg = msg.replace(/[^a-z0-9]+/ig, '');
      if (msg.length % 2 !== 0)
        msg = '0' + msg;
      for (var i = 0; i < msg.length; i += 8) {
        var slice = msg.slice(i, i + 8);
        var num = parseInt(slice, 16);

        if (slice.length === 8)
          res.push((num >>> 24) & 0xff);
        if (slice.length >= 6)
          res.push((num >>> 16) & 0xff);
        if (slice.length >= 4)
          res.push((num >>> 8) & 0xff);
        res.push(num & 0xff);
      }
    }
  } else {
    for (var i = 0; i < msg.length; i++)
      res[i] = msg[i] | 0;
  }
  return res;
}
utils.toArray = toArray;

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

bitcoindjs.Block = Block;
bitcoindjs.Transaction = Transaction;
bitcoindjs.blockToHex = Block.toHex;
bitcoindjs.txToHex = Transaction.toHex;

exports.Block = Block;
exports.block = Block;

exports.Transaction = Transaction;
exports.transaction = Transaction;
exports.tx = Transaction;

exports.Wallet = Wallet;
exports.wallet = Wallet;

exports.script = script;

exports.utils = utils;
