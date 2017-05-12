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

var utils = {};

utils.writeConfigFile = function(fileStr, obj) {
  fs.writeFileSync(fileStr, JSON.stringify(obj));
};

utils.toArgs = function(opts) {
  return Object.keys(opts).map(function(key) {
    return '-' + key + '=' + opts[key];
  });
};

utils.waitForService = function(task, callback) {
  var retryOpts = { times: 20, interval: 1000 };
  async.retry(retryOpts, task, callback);
};

utils.queryBitcoreNode = function(httpOpts, callback) {
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

utils.waitForBitcoreNode = function(opts, callback) {

  var self = this;

  opts.bitcore.process.stdout.on('data', function(data) {
    if (opts.debug) {
      console.log(data.toString());
    }
  });

  opts.bitcore.process.stderr.on('data', function(data) {
    console.log(data.toString());
  });

  var errorFilter = function(err, res) {
    try {
      var info = JSON.parse(res);
      if (info.dbheight === opts.blockHeight &&
        info.bitcoindheight === opts.blockHeight) {
        return;
      }
      return res;
    } catch(e) {
      return e;
    }
  };

  var httpOpts = self.getHttpOpts(opts, { path: '/wallet-api/info', errorFilter: errorFilter });

  self.waitForService(self.queryBitcoreNode.bind(self, httpOpts), callback);
};

utils.waitForBitcoinReady = function(opts, callback) {

  var self = this;
  self.waitForService(function(callback) {

    opts.rpc.generate(opts.initialHeight, function(err, res) {

      if (err || (res && res.error)) {
        return callback('keep trying');
      }
      opts.blockHeight += opts.initialHeight;
      callback();
    });
  }, function(err) {

    if(err) {
      return callback(err);
    }

    callback();

  }, callback);

};

utils.initializeAndStartService = function(opts, callback) {

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

utils.startBitcoreNode = function(opts, callback) {
  this.initializeAndStartService(opts.bitcore, callback);
};

utils.startBitcoind = function(opts, callback) {
  this.initializeAndStartService(opts.bitcoin, callback);
};

utils.unlockWallet = function(opts, callback) {
  opts.rpc.walletPassPhrase(opts.walletPassphrase, 3000, function(err) {
    if(err && err.code !== -15) {
      return callback(err);
    }
    callback();
  });
};

utils.getPrivateKeysWithABalance = function(opts, callback) {

  opts.rpc.listUnspent(function(err, res) {

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

      opts.rpc.dumpPrivKey(utxo.address, function(err, res) {
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

utils.generateSpendingTxs = function(opts, utxos) {

  return utxos.map(function(utxo) {

    var toPrivKey = new PrivateKey('testnet'); //external addresses
    var changePrivKey = new PrivateKey('testnet'); //our wallet keys
    var utxoSatoshis = Unit.fromBTC(utxo.utxo.amount).satoshis;
    var satsToPrivKey = Math.round(utxoSatoshis / 2);
    var tx = new Transaction();

    tx.from(utxo.utxo);
    tx.to(toPrivKey.toAddress().toString(), satsToPrivKey);
    tx.fee(opts.fee);
    tx.change(changePrivKey.toAddress().toString());
    tx.sign(utxo.privKey);

    opts.walletPrivKeys.push(changePrivKey);
    opts.satoshisReceived += Unit.fromBTC(utxo.utxo.amount).toSatoshis() - (satsToPrivKey + opts.fee);
    return tx;
  });

};

utils.setupInitialTxs = function(opts, callback) {

  var self = this;
  self.getPrivateKeysWithABalance(opts, function(err, utxos) {

    if(err) {
      return callback(err);
    }
    opts.initialTxs = self.generateSpendingTxs(opts, utxos);
    callback();
  });

};

utils.sendTxs = function(opts, callback) {
  async.eachOfSeries(opts.initialTxs, this.sendTx.bind(this, opts), callback);
};

utils.sendTx = function(opts, tx, index, callback) {

  opts.rpc.sendRawTransaction(tx.serialize(), function(err) {
    if (err) {
      return callback(err);
    }
    var mod = index % 2;
    if (mod === 1) {
      opts.blockHeight++;
      opts.rpc.generate(1, callback);
    } else {
      callback();
    }
  });

};

utils.getHttpOpts = function(opts, httpOpts) {
  return Object.assign({
    path: httpOpts.path,
    method: httpOpts.method || 'GET',
    body: httpOpts.body,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': httpOpts.length || 0
    },
    errorFilter: httpOpts.errorFilter
  }, opts.bitcore.httpOpts);
};

utils.registerWallet = function(opts, callback) {

  var httpOpts = this.getHttpOpts(opts, { path: '/wallet-api/wallets/' + opts.walletId, method: 'POST' });
  this.queryBitcoreNode(httpOpts, callback);

};

utils.uploadWallet = function(opts, callback) {

  var self = this;
  var addresses = JSON.stringify(opts.walletPrivKeys.map(function(privKey) {
    if (privKey.privKey) {
      return privKey.pubKey.toString();
    }
    return privKey.toAddress().toString();
  }));

  var httpOpts = self.getHttpOpts(opts, {
    path: '/wallet-api/wallets/' + opts.walletId + '/addresses',
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

    var httpOpts = self.getHttpOpts(opts, { path: '/wallet-api/jobs/' + job.jobId });

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

utils.getListOfTxs = function(opts, callback) {

  var self = this;
  var end = Date.now() + 86400000;
  var httpOpts = self.getHttpOpts(opts, {
    path: '/wallet-api/wallets/' + opts.walletId + '/transactions?start=0&end=' + end });

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

    var map = opts.initialTxs.map(function(tx) {
      return tx.serialize();
    });

    results.forEach(function(result) {
      var tx = new Transaction(result);
      map.splice(map.indexOf(tx.uncheckedSerialize()), 1);
    });

    map.length.should.equal(0);
    results.length.should.equal(opts.initialTxs.length);
    callback();
  });
};

utils.cleanup = function(opts, callback) {
  opts.bitcore.process.kill();
  opts.bitcoin.process.kill();
  setTimeout(callback, 2000);
};

module.exports = utils;
