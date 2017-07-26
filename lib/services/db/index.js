'use strict';

var util = require('util');
var fs = require('fs');
var async = require('async');
var levelup = require('levelup');
var leveldown = require('leveldown');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore-lib');
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var Service = require('../../service');
var constants = require('../../constants');
var log = require('../../index').log;
var assert = require('assert');

function DB(options) {

  if (!(this instanceof DB)) {
    return new DB(options);
  }
  options = options || {};

  Service.call(this, options);

  this._dbPrefix = constants.DB_PREFIX;

  this.version = 1;

  this.network = this.node.network;

  this._setDataPath();

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.subscriptions = {};

  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];

  this.node.on('stopping', function() {
    log.warn('Node is stopping, gently closing the database.');
  });
}

util.inherits(DB, Service);

DB.dependencies = [];

DB.prototype._onError = function(err) {
  log.error('Db Service: error: ' + err);
  this.node.stop();
  process.exit(-1);
};

DB.prototype._setDataPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  if (this.node.network === Networks.livenet) {
    this.dataPath = this.node.datadir + '/bitcore-node.db';
  } else if (this.node.network === Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      this.dataPath = this.node.datadir + '/regtest/bitcore-node.db';
    } else {
      this.dataPath = this.node.datadir + '/testnet3/bitcore-node.db';
    }
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

DB.prototype._setVersion = function(callback) {
  var versionBuffer = new Buffer(new Array(4));
  versionBuffer.writeUInt32BE(this.version);
  this.put(Buffer.concat([ this._dbPrefix, new Buffer('version', 'utf8') ]), versionBuffer, callback);
};

DB.prototype.start = function(callback) {
  var self = this;

  if (!fs.existsSync(self.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  self._store = levelup(self.dataPath, { db: self.levelupStore, keyEncoding: 'binary', valueEncoding: 'binary'});

  setImmediate(callback);

};

DB.prototype.get = function(key, options, callback) {

  var cb = callback;
  var opts = options;

  if (typeof callback !== 'function') {
    cb = options;
    opts = {};
  }

  if (!this._stopping) {

    this._store.get(key, opts, function(err, data) {

      if(err && err instanceof levelup.errors.NotFoundError) {
        return cb();
      }

      if (err) {
        return cb(err);
      }

      cb(null, data);

    });

  } else {

    cb(new Error('Shutdown sequence underway, not able to complete the query'));
  }

};

DB.prototype.put = function(key, value, callback) {

  assert(Buffer.isBuffer(key), 'key NOT a buffer as expected.');

  if (value) {

    assert(Buffer.isBuffer(value), 'value exists but NOT a buffer as expected.');

  }

  var self = this;

  if (self._stopping) {
    return;
  }

  self._store.put(key, value, callback);
};

DB.prototype.batch = function(ops, callback) {

  var self = this;

  if (self._stopping) {
    return;
  }

  for(var i = 0; i < ops.length; i++) {

    assert(Buffer.isBuffer(ops[i].key), 'key NOT a buffer as expected.');

    if (ops[i].value) {

      assert(Buffer.isBuffer(ops[i].value), 'value exists but NOT a buffer as expected.');

    }
  }

  self._store.batch(ops, callback);

};

DB.prototype.createReadStream = function(op) {
  var stream;
  if (!this._stopping) {
    stream = this._store.createReadStream(op);
  }
  if (stream) {
    stream.on('error', this._onError.bind(this));
  }
  return stream;
};

DB.prototype.createKeyStream = function(op) {
  var stream;
  if (!this._stopping) {
    stream = this._store.createKeyStream(op);
  }
  if (stream) {
    stream.on('error', this.onError.bind(this));
  }
  return stream;
};

DB.prototype.stop = function(callback) {
  this._stopping = true;
  this.close(callback);
};

DB.prototype.close = function(callback) {
  if (this._store && this._store.isOpen()) {
    this._store.close(callback);
  }
};

DB.prototype.getAPIMethods = function() {
  return [];
};


DB.prototype.getPublishEvents = function() {
  return [];
};

DB.prototype.getServiceTip = function(serviceName, callback) {

  var keyBuf = Buffer.concat([ this._dbPrefix, new Buffer('tip-' + serviceName, 'utf8') ]);

  var self = this;
  self.get(keyBuf, function(err, tipBuf) {

    if (err) {
      return callback(err);
    }

    var tip;
    if (tipBuf) {

      tip = {
        height: tipBuf.readUInt32BE(0,4),
        hash: tipBuf.slice(4).toString('hex')
      };

    } else {

      tip = {
        height: 0,
        hash: self.GENESIS_HASH
      };

    }

    callback(null, tip);
  });

};


DB.prototype.getPrefix = function(service, callback) {
  var self = this;

    var keyBuf = Buffer.concat([ self._dbPrefix, new Buffer('prefix-', 'utf8'), new Buffer(service, 'utf8') ]);
    var unusedBuf = Buffer.concat([ self._dbPrefix, new Buffer('nextUnused', 'utf8') ]);

  function getPrefix(next) {

    self.get(keyBuf, function(err, buf) {

      if (err) {
        return callback(err);
      }
      if (!buf) {
        return next();
      }
      callback(null, buf);
    });

  }

  function getUnused(next) {

    self.get(unusedBuf, function(err, buffer) {

      if(err) {
        return callback(err);
      }

      if(!buffer) {
        return next(null, new Buffer('0001', 'hex'));
      }

      next(null, buffer);
    });
  }

  function putPrefix(buffer, next) {

    self.put(keyBuf, buffer, function(err) {

      if (err) {
        return callback(err);
      }

      next(null, buffer);

    });

  }

  function putUnused(buffer, next) {

    var prefix = buffer.readUInt16BE();
    var nextUnused = new Buffer(2);
    nextUnused.writeUInt16BE(prefix + 1);

    self.put(unusedBuf, nextUnused, function(err) {

      if (err) {
        return callback(err);
      }

      next(null, buffer);

    });
  }

  async.waterfall(
    [
      getPrefix,
      getUnused,
      putPrefix,
      putUnused
    ],
    callback
  );
};

module.exports = DB;
