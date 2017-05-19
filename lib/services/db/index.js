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

function DB(options) {

  if (!(this instanceof DB)) {
    return new DB(options);
  }
  options = options || {};

  Service.call(this, options);

  this.version = 2;

  this.dbPrefix = '\u0000\u0000';

  $.checkState(this.node.network, 'Node is expected to have a "network" property');
  this.network = this.node.network;

  this._setDataPath();

  this.levelupStore = leveldown;
  if (options.store) {
    this.levelupStore = options.store;
  }

  this.subscriptions = {};

  this.bitcoind = this.node.services.bitcoind;
  this._operationsQueue = [];
}

util.inherits(DB, Service);

DB.dependencies = ['bitcoind'];

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

DB.prototype._checkVersion = function(callback) {
  var self = this;

  self.get(self.dbPrefix + 'tip', self.dbOptions, function(err) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback();
    } else if (err) {
      return callback(err);
    }
    self.get(self.dbPrefix + 'version', self.dbOptions, function(err, buffer) {
      var version;
      if (err instanceof levelup.errors.NotFoundError) {
        version = 1;
      } else if (err) {
        return callback(err);
      } else {
        version = buffer.readUInt32BE();
      }
      if (self.version !== version) {
        var helpUrl = 'https://github.com/bitpay/bitcore-node/blob/master/docs/services/db.md#how-to-reindex';
        return callback(new Error(
          'The version of the database "' + version + '" does not match the expected version "' +
            self.version + '". A recreation of "' + self.dataPath + '" (can take several hours) is ' +
            'required or to switch versions of software to match. Please see ' + helpUrl +
            ' for more information.'
        ));
      }
      callback();
    });
  });
};

DB.prototype._setVersion = function(callback) {
  var versionBuffer = new Buffer(new Array(4));
  versionBuffer.writeUInt32BE(this.version);
  this._store.put(this.dbPrefix + 'version', versionBuffer, callback);
};

DB.prototype.start = function(callback) {
  var self = this;

  if (!fs.existsSync(self.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  self._store = levelup(self.dataPath, { db: self.levelupStore, keyEncoding: 'binary', valueEncoding: 'binary'});


  setImmediate(function() {
    self._checkVersion(self._setVersion.bind(self, callback));
  });

};

DB.prototype.get = function(key, options, callback) {
  var cb = callback;
  var opts = options;
  if (typeof callback !== 'function') {
    cb = options;
    opts = {};
  }
  if (!this._stopping) {
    this._store.get(key, opts, cb);
  } else {
    setImmediate(cb);
  }
};

DB.prototype.put = function(key, value, options, callback) {
  var cb = callback;
  var opts = options;
  if (typeof callback !== 'function') {
    cb = options;
    opts = {};
  }
  if (!this._stopping) {
    this._store.put(key, value, opts, cb);
  } else {
    setImmediate(cb);
  }
};

DB.prototype.batch = function(ops, options, callback) {
  var cb = callback;
  var opts = options;
  if (typeof callback !== 'function') {
    cb = options;
    opts = {};
  }
  if (!this._stopping) {
    this._store.batch(ops, opts, cb);
  } else {
    setImmediate(cb);
  }
};

DB.prototype.createReadStream = function(op) {
  var stream;
  if (!this._stopping) {
    stream = this._store.createReadStream(op);
  }
  return stream;
};

DB.prototype.createKeyStream = function(op) {
  var stream;
  if (!this._stopping) {
    stream = this._store.createKeyStream(op);
  }
  return stream;
};

DB.prototype.stop = function(callback) {
  var self = this;
  self._stopping = true;
  async.whilst(function() {
    return self._operationsQueue > 0;
  }, function(next) {
    setTimeout(next, 3000);
  }, function() {
    self.close(callback);
  });
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

DB.prototype.getPrefix = function(service, callback) {
  var self = this;

  function getPrefix(next) {
    self.get(self.dbPrefix + 'prefix-' + service, function(err, buffer) {
      if(err) {
        if(err.notFound) {
          return next();
        }
        return next(err);
      }
      return callback(null, buffer);
    });
  }

  function getUnused(next) {
    self.get(self.dbPrefix + 'nextUnused', function(err, buffer) {
      if(err) {
        if(err.notFound) {
          return next(null, new Buffer('0001', 'hex'));
        }
        return next(err);
      }

      return next(null, buffer);
    });
  }

  function putPrefix(buffer, next) {
    self._store.put(self.dbPrefix + 'prefix-' + service, buffer, function(err) {
      if(err) {
        return next(err);
      }

      next(null, buffer);
    });
  }

  function putUnused(buffer, next) {
    var prefix = buffer.readUInt16BE();
    var nextUnused = new Buffer(2);
    nextUnused.writeUInt16BE(prefix + 1);

    self._store.put(self.dbPrefix + 'nextUnused', nextUnused, function(err) {
      if(err) {
        return next(err);
      }

      return next(null, buffer);
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
