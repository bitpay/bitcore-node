'use strict';

var bitcore = require('bitcore-lib');
var _ = require('lodash');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var fs = require('fs');
var async = require('async');
var spawn = require('child_process').spawn;
var http = require('http');
var Unit = bitcore.Unit;
var Transaction = bitcore.Transaction;
var PrivateKey = bitcore.PrivateKey;

var Utils = function(opts) {
  this.opts = opts;
};

Utils.prototype.writeConfigFile = function(fileStr, obj) {
  fs.writeFileSync(fileStr, JSON.stringify(obj));
};

Utils.prototype.toArgs = function(opts) {
  return Object.keys(opts).map(function(key) {
    return '-' + key + '=' + opts[key];
  });
};

Utils.prototype.waitForService = function(task, callback) {
  var retryOpts = { times: 20, interval: 1000 };
  async.retry(retryOpts, task, callback);
};

Utils.prototype.queryBitcoreNode = function(httpOpts, callback) {
  var error;
  var request = http.request(httpOpts, function(res) {

    if (res.statusCode !== 200 && res.statusCode !== 201) {
      if (error) {
        return;
      }
      return callback(res.statusCode);
    }

    var resError;
    var resData = '';

    res.on('error', function(e) {
      resError = e;
    });

    res.on('data', function(data) {
      resData += data;
    });

    res.on('end', function() {
      if (error) {
        return;
      }
      if (httpOpts.errorFilter) {
        return callback(httpOpts.errorFilter(resError, resData));
      }
      callback(resError, resData);
    });

  });

  request.on('error', function(e) {
    error = e;
    callback(error);
  });

  request.write(httpOpts.body || '');
  request.end();
};

Utils.prototype.waitForBitcoreNode = function(callback) {

  var self = this;

  var errorFilter = self.opts.errorFilter;
  if (!errorFilter) {
    errorFilter = function(err, res) {
      try {
        var info = JSON.parse(res);
        if (info.dbheight === self.opts.blockHeight &&
          info.dbheight === info.bitcoindheight &&
          info.bitcoindhash === info.dbhash) {
          return;
        }
        return res;
      } catch(e) {
        return e;
      }
    };
  }
  var httpOpts = self.getHttpOpts({ path: opts.path || '/info', errorFilter: errorFilter });

  self.waitForService(self.queryBitcoreNode.bind(self, httpOpts), callback);
};

Utils.prototype.waitForBitcoinReady = function(callback) {

  var self = this;
  self.waitForService(function(callback) {

    self.opts.rpc.generate(self.opts.initialHeight, function(err, res) {

      if (err || (res && res.error)) {
        return callback('keep trying');
      }
      self.opts.blockHeight += self.opts.initialHeight;
      callback();
    });
  }, function(err) {

    if(err) {
      return callback(err);
    }

    callback();

  }, callback);

};

Utils.prototype.initializeAndStartService = function(opts, callback) {

  var self = this;

  rimraf(opts.datadir, function(err) {

    if(err) {
      return callback(err);
    }

    mkdirp(opts.datadir, function(err) {

      if(err) {
        return callback(err);
      }

      if (opts.configFile) {
        self.writeConfigFile(opts.configFile.file, opts.configFile.conf);
      }

      var args = _.isArray(opts.args) ? opts.args : self.toArgs(opts.args);
      opts.process = spawn(opts.exec, args, opts.opts);
      callback();

    });
  });

};

Utils.prototype.startBitcoreNode = function(callback) {
  var self = this;
  this.initializeAndStartService(self.opts.bitcore, function(err) {

    if(err) {
      return callback(err);
    }

    self.opts.bitcore.process.stdout.on('data', function(data) {
      if (self.opts.debug) {
        process.stdout.write(data.toString());
      }
    });

    self.opts.bitcore.process.stderr.on('data', function(data) {
      process.stdout.write(data.toString());
    });


    callback();

  });
};

Utils.prototype.startBitcoind = function(callback) {
  var self = this;
  self.initializeAndStartService(self.opts.bitcoin, function() {

    // in case you choose to -printtoconsole
    self.opts.bitcoin.process.stdout.on('data', function(data) {
      if (self.opts.debug) {
        process.stdout.write(data.toString());
      }
    });

    self.opts.bitcoin.process.stderr.on('data', function(data) {
      process.stdout.write(data.toString());
    });

    callback();
  });
};

Utils.prototype.unlockWallet = function(callback) {
  this.opts.rpc.walletPassPhrase(this.opts.walletPassphrase, 3000, function(err) {
    if(err && err.code !== -15) {
      return callback(err);
    }
    callback();
  });
};

Utils.prototype.getPrivateKeysWithABalance = function(callback) {

  var self = this;
  self.opts.rpc.listUnspent(function(err, res) {

    if(err) {
      return callback(err);
    }

    var utxos = [];
    for(var i = 0; i < res.result.length; i++) {
      if (res.result[i].amount > 1) {
        utxos.push(res.result[i]);
      }
    }
    if (utxos.length <= 0) {
      return callback(new Error('no utxos available'));
    }
    async.mapLimit(utxos, 8, function(utxo, callback) {

      self.opts.rpc.dumpPrivKey(utxo.address, function(err, res) {
        if(err) {
          return callback(err);
        }
        var privKey = res.result;
        callback(null, { utxo: utxo, privKey: privKey });
      });

    }, function(err, utxos) {
      if(err) {
        return callback(err);
      }
      callback(null, utxos);
    });
  });

};

Utils.prototype.generateSpendingTxs = function(utxos) {

  var self = this;
  return utxos.map(function(utxo) {

    var toPrivKey = new PrivateKey('testnet'); //external addresses
    var changePrivKey = new PrivateKey('testnet'); //our wallet keys
    var utxoSatoshis = Unit.fromBTC(utxo.utxo.amount).satoshis;
    var satsToPrivKey = Math.round(utxoSatoshis / 2);
    var tx = new Transaction();

    tx.from(utxo.utxo);
    tx.to(toPrivKey.toAddress().toString(), satsToPrivKey);
    tx.fee(self.opts.fee);
    tx.change(changePrivKey.toAddress().toString());
    tx.sign(utxo.privKey);

    self.opts.walletPrivKeys.push(changePrivKey);
    self.opts.satoshisReceived += Unit.fromBTC(utxo.utxo.amount).toSatoshis() - (satsToPrivKey + self.opts.fee);
    return tx;
  });

};

Utils.prototype.setupInitialTxs = function(callback) {

  var self = this;
  self.getPrivateKeysWithABalance(function(err, utxos) {

    if(err) {
      return callback(err);
    }
    self.opts.initialTxs = self.generateSpendingTxs(utxos);
    callback();
  });

};

Utils.prototype.sendTxs = function(callback) {
  async.eachOfSeries(this.opts.initialTxs, this.sendTx.bind(this), callback);
};

Utils.prototype.sendTx = function(tx, index, callback) {

  var self = this;
  self.opts.rpc.sendRawTransaction(tx.serialize(), function(err) {
    if (err) {
      return callback(err);
    }
    var mod = index % 2;
    if (mod === 1) {
      self.opts.blockHeight++;
      self.opts.rpc.generate(1, callback);
    } else {
      callback();
    }
  });

};

Utils.prototype.getHttpOpts = function(httpOpts) {
  return Object.assign({
    path: httpOpts.path,
    method: httpOpts.method || 'GET',
    body: httpOpts.body,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': httpOpts.length || 0
    },
    errorFilter: httpOpts.errorFilter
  }, this.opts.bitcore.httpOpts);
};

Utils.prototype.registerWallet = function(callback) {

  var httpOpts = this.getHttpOpts(this.opts, { path: '/wallet-api/wallets/' + this.opts.walletId, method: 'POST' });
  this.queryBitcoreNode(httpOpts, callback);

};

Utils.prototype.uploadWallet = function(callback) {

  var self = this;
  var addresses = JSON.stringify(self.opts.walletPrivKeys.map(function(privKey) {
    if (privKey.privKey) {
      return privKey.pubKey.toString();
    }
    return privKey.toAddress().toString();
  }));

  var httpOpts = self.getHttpOpts(self.opts, {
    path: '/wallet-api/wallets/' + self.opts.walletId + '/addresses',
    method: 'POST',
    body: addresses,
    length: addresses.length
  });

  async.waterfall([ self.queryBitcoreNode.bind(self, httpOpts) ], function(err, res) {
    if (err) {
      return callback(err);
    }
    var job = JSON.parse(res);

    Object.keys(job).should.deep.equal(['jobId']);

    var httpOpts = self.getHttpOpts(self.opts, { path: '/wallet-api/jobs/' + job.jobId });

    async.retry({ times: 10, interval: 1000 }, function(next) {
      self.queryBitcoreNode(httpOpts, function(err, res) {
        if (err) {
          return next(err);
        }
        var result = JSON.parse(res);
        if (result.status === 'complete') {
          return next();
        }
        next(res);
      });

    }, function(err) {
      if(err) {
        return callback(err);
      }
      callback();
    });
  });

};

Utils.prototype.getListOfTxs = function(callback) {

  var self = this;
  var end = Date.now() + 86400000;
  var httpOpts = self.getHttpOpts(self.opts, {
    path: '/wallet-api/wallets/' + self.opts.walletId + '/transactions?start=0&end=' + end });

  self.queryBitcoreNode(httpOpts, function(err, res) {
    if(err) {
      return callback(err);
    }
    var results = [];
    res.split('\n').forEach(function(result) {

      if (result.length > 0) {
        return results.push(JSON.parse(result));
      }

    });

    var map = self.opts.initialTxs.map(function(tx) {
      return tx.serialize();
    });

    results.forEach(function(result) {
      var tx = new Transaction(result);
      map.splice(map.indexOf(tx.uncheckedSerialize()), 1);
    });

    map.length.should.equal(0);
    results.length.should.equal(self.opts.initialTxs.length);
    callback();
  });
};

Utils.prototype.cleanup = function(callback) {
  this.opts.bitcore.process.kill();
  this.opts.bitcoin.process.kill();
  setTimeout(callback, 2000);
};

module.exports = Utils;
