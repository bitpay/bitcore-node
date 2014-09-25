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
};

/**
 * Broadcast TX
 */

Bitcoin._broadcastTx = function(tx, options, callback) {
  if (!callback) {
    callback = options;
    options = null;
  }

  if (!options) {
    options = {};
  }

  options.overrideFees = options.overrideFees || false;

  return bitcoindjs.broadcastTx(tx, options.overrideFees, callback);
};

Transaction.binary = function(tx) {
  var p = [];
  var off = utils.writeU32(p, tx.nVersion, 0);
  off += utils.varint(p, tx.vin.length, off);

  for (var i = 0; i < tx.vin.length; i++) {
    var input = tx.vin[i];

    off += utils.copy(utils.toArray(input.out.hash, 'hex'), p, off, true);
    off += utils.writeU32(p, input.out.index, off);

    var s = script.encode(input.script);
    off += utils.varint(p, s.length, off);
    off += utils.copy(s, p, off, true);

    off += utils.writeU32(p, input.seq, off);
  }

  off += utils.varint(p, tx.vout.length, off);
  for (var i = 0; i < tx.vout.length; i++) {
    var output = tx.vout[i];

    // Put LE value
    var value = output.value.toArray().slice().reverse();
    assert(value.length <= 8);
    off += utils.copy(value, p, off, true);
    for (var j = value.length; j < 8; j++, off++)
      p[off] = 0;

    var s = script.encode(output.script);
    off += utils.varint(p, s.length, off);
    off += utils.copy(s, p, off, true);
  }
  off += utils.writeU32(p, tx.nLockTime, off);

  return p;
};

var script = {};

script.encode = function encode(s) {
  if (!s)
    return [];
  var opcodes = constants.opcodes;
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
        res = res.concat(opcodes.pushdata1, instr.length, instr);
      } else if (instr.length <= 0xffff) {
        res.push(opcodes.pushdata2);
        utils.writeU16(res, instr.length, res.length);
        res = res.concat(instr);
      } else {
        res.push(opcodes.pushdata4);
        utils.writeU32(res, instr.length, res.length);
        res = res.concat(instr);
      }
      continue;
    }

    res.push(opcodes[instr] || instr);
  }

  return res;
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
