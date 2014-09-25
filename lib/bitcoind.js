/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 * A bitcoind node.js binding.
 */

var net = require('net');
var EventEmitter = require('events').EventEmitter;
var bitcoindjs = require('../build/Release/bitcoindjs.node');
var util = require('util');
var net = require('net');
var bn = require('bn.js');

/**
 * Bitcoin
 */

function Bitcoin(options) {
  var self = this;

  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  EventEmitter.call(this);

  this.options = options;
}

Bitcoin.prototype.__proto__ = EventEmitter.prototype;

Bitcoin.prototype.start = function(callback) {
  var self = this;

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
      return process.stdout.write('bitcoind: ' + data + '\n');
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
        // XXX Bad workaround
        if (self._emitted[block.hash]) {
          return setImmediate(function() {
            return nextBlock();
          });
        }
        self._emitted[block.hash] = true;

        self.emit('block', block);

        return utils.forEach(block.tx, function(tx, nextTx) {
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
  return bitcoindjs.getBlock(blockHash, callback);
};

Bitcoin.prototype.getTx = function(txHash, blockHash, callback) {
  if (!callback) {
    callback = blockHash;
    blockHash = '';
  }

  // if (txHash[1] === 'x') txHash = txHash.slice(2);
  // txHash = utils.revHex(txHash);

  // if (blockHash) {
  //   if (blockHash[1] === 'x') blockHash = blockHash.slice(2);
  //   blockHash = utils.revHex(blockHash);
  // }

  return bitcoindjs.getTx(txHash, blockHash, callback);
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
}

/**
 * Transaction
 */

function Transaction(data) {
  if (!(this instanceof Transaction)) {
    return new Transaction(data);
  }

  this.nMinTxFee = data.nMinTxFee || new bn(0);
  this.nMinRelayTxFee = data.nMinRelayTxFee || new bn(0);
  this.CURRENT_VERSION = 1;
  this.nVersion = data.nVersion || -1;
  this.vin = data.vin || [];
  this.vout = data.vout || [];
  this.nLockTime = data.nLockTime || null;
}

Transaction.prototype.getSerializeSize = function() {
  ;
};

Transaction.prototype.serialize = function() {
  ;
};

Transaction.prototype.unserialize = function() {
  ;
};

Transaction.prototype.setNull = function() {
  ;
};

Transaction.prototype.isNull = function() {
  ;
};

Transaction.prototype.getHash = function() {
  ;
};

Transaction.prototype.getValueOut = function() {
  ;
};

Transaction.prototype.computePriority = function() {
  ;
};

Transaction.prototype.isCoinbase = function() {
  ;
};

Transaction.prototype.equal = function() {
  ;
};

Transaction.prototype.notEqual = function() {
  ;
};

Transaction.prototype.toString = function() {
  ;
};

Transaction.prototype.print = function() {
  ;
};

Transaction.prototype.toHex = function() {
  return this.hex = this.hex || Transaction.toHex(this);
};

Transaction.toHex = function(tx) {
  return new bn(Transaction.binary(tx)).toString('hex');
};

/**
 * Broadcast TX
 */

Bitcoin._broadcastTx =
Bitcoin.prototype._broadcastTx = function(tx, options, callback) {
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

  options.overrideFees = options.overrideFees || false;
  options.ownOnly = options.ownOnly || false;

  return bitcoindjs.broadcastTx(tx,
    options.overrideFees,
    options.ownOnly,
    callback);
};

Transaction.binary = function(tx) {
  var p = [];
  var off = utils.writeU32(p, tx.nVersion || tx.version, 0);
  off += utils.varint(p, tx.vin.length, off);

  for (var i = 0; i < tx.vin.length; i++) {
    var input = tx.vin[i];

    if (input.coinbase) {
      off += utils.copy(new bn(input.coinbase, 'hex').toArray(), p, off, true);
      off += utils.writeU32(p, input.sequence, off);
    } else {
      off += utils.copy(new bn(input.txid, 'hex').toArray(), p, off, true);
      off += utils.writeU32(p, input.vout, off);

      // var s = script.encode(input.scriptSig.asm.split(' '));
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

    //var s = script.encode(output.scriptPubKey.asm.split(' '));
    var s = script.encode(new bn(output.scriptPubKey.hex, 'hex').toArray());
    off += utils.varint(p, s.length, off);
    off += utils.copy(s, p, off, true);
  }
  off += utils.writeU32(p, tx.nLockTime || tx.locktime, off);

  return p;
};

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
        // res = res.concat(script.opcodes.pushdata1, instr.length, instr);
        res = res.concat(0x4c, instr.length, instr);
      } else if (instr.length <= 0xffff) {
        // res.push(script.opcodes.pushdata2);
        res.push(0x4d);
        utils.writeU16(res, instr.length, res.length);
        res = res.concat(instr);
      } else {
        // res.push(script.opcodes.pushdata4);
        res.push(0x4e);
        utils.writeU32(res, instr.length, res.length);
        res = res.concat(instr);
      }
      continue;
    }

    // res.push(script.opcodes[instr] || instr);
    res.push(instr);
  }

  return res;
};

script.opcodes = {
  0: 0,
  pushdata1: 0x4c,
  pushdata2: 0x4d,
  pushdata4: 0x4e,
  negate1: 0x4f,

  nop: 0x61,
  if_: 0x63,
  notif: 0x64,
  else_: 0x67,
  endif: 0x68,
  verify: 0x69,
  ret: 0x6a,

  toaltstack: 0x6b,
  fromaltstack: 0x6c,
  ifdup: 0x73,
  depth: 0x74,
  drop: 0x75,
  dup: 0x76,
  nip: 0x77,
  over: 0x78,
  pick: 0x79,
  roll: 0x7a,
  rot: 0x7b,
  swap: 0x7c,
  tuck: 0x7d,
  drop2: 0x6d,
  dup2: 0x6e,
  dup3: 0x6f,
  over2: 0x70,
  rot2: 0x71,
  swap2: 0x72,

  cat: 0x74,
  substr: 0x7f,
  left: 0x80,
  right: 0x81,
  size: 0x82,

  invert: 0x83,
  and: 0x84,
  or: 0x85,
  xor: 0x86,
  eq: 0x87,
  eqverify: 0x88,

  add1: 0x8b,
  sub1: 0x8c,
  mul2: 0x8d,
  div2: 0x8e,
  negate: 0x8f,
  abs: 0x90,
  not: 0x91,
  noteq0: 0x92,
  add: 0x93,
  sub: 0x94,
  mul: 0x95,
  div: 0x96,
  mod: 0x97,
  lshift: 0x98,
  rshift: 0x99,
  booland: 0x9a,
  boolor: 0x9b,
  numeq: 0x9c,
  numeqverify: 0x9d,
  numneq: 0x9e,
  lt: 0x9f,
  gt: 0xa0,
  lte: 0xa1,
  gte: 0xa2,
  min: 0xa3,
  max: 0xa4,
  within: 0xa5,

  ripemd160: 0xa6,
  sha1: 0xa7,
  sha256: 0xa8,
  hash160: 0xa9,
  hash256: 0xaa,
  codesep: 0xab,
  checksig: 0xac,
  checksigverify: 0xad,
  checkmultisig: 0xae,
  checkmultisigverify: 0xaf
};

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

utils.writeU64 = function writeU64(dst, num, off) {
  if (!off)
    off = 0;

  num = new bn(num).maskn(64).toArray();
  while (num.length < 8)
    num.unshift(0);

  num.reverse().forEach(function(ch) {
    dst[off++] = ch;
  });

  var i = num.length;
  while (i--)
    dst[off++] = num[i];

  return 8;
};

utils.writeU16BE = function writeU16BE(dst, num, off) {
  if (!off)
    off = 0;
  dst[off] = (num >>> 8) & 0xff;
  dst[off + 1] = num & 0xff;
  return 2;
};

utils.writeU32BE = function writeU32BE(dst, num, off) {
  if (!off)
    off = 0;
  dst[off] = (num >>> 24) & 0xff;
  dst[off + 1] = (num >>> 16) & 0xff;
  dst[off + 2] = (num >>> 8) & 0xff;
  dst[off + 3] = num & 0xff;
  return 4;
};

utils.writeU64BE = function writeU64BE(dst, num, off) {
  if (!off)
    off = 0;

  num = new bn(num).maskn(64).toArray();
  while (num.length < 8)
    num.unshift(0);

  for (var i = 0; i < num.length; i++)
    dst[off++] = num[i];

  return 8;
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

/**
 * Expose
 */

module.exports = exports = Bitcoin;
exports.Bitcoin = Bitcoin;
exports.native = bitcoindjs;
exports.utils = utils;
