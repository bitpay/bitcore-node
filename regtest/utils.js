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
var crypto = require('crypto');

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

utils.waitForBitcoreNode = function(callback) {

  bitcore.process.stdout.on('data', function(data) {
    if (debug) {
      console.log(data.toString());
    }
  });

  bitcore.process.stderr.on('data', function(data) {
    console.log(data.toString());
  });

  var errorFilter = function(err, res) {
    try {
      if (JSON.parse(res).height === blockHeight) {
        return;
      }
      return res;
    } catch(e) {
      return e;
    }
  };

  var httpOpts = getHttpOpts({ path: '/wallet-api/info', errorFilter: errorFilter });

  waitForService(queryBitcoreNode.bind(this, httpOpts), callback);
};

utils.waitForBitcoinReady = function(callback) {
  waitForService(function(callback) {
    rpc.generate(initialHeight, function(err, res) {
      if (err || (res && res.error)) {
        return callback('keep trying');
      }
      blockHeight += initialHeight;
      callback();
    });
  }, function(err) {
    if(err) {
      return callback(err);
    }
    callback();
  }, callback);
}

utils.initializeAndStartService = function(opts, callback) {
  rimraf(opts.datadir, function(err) {
    if(err) {
      return callback(err);
    }
    mkdirp(opts.datadir, function(err) {
      if(err) {
        return callback(err);
      }
      if (opts.configFile) {
        writeConfigFile(opts.configFile.file, opts.configFile.conf);
      }
      var args = _.isArray(opts.args) ? opts.args : toArgs(opts.args);
      opts.process = spawn(opts.exec, args, opts.opts);
      callback();
    });
  });
}

utils.startBitcoreNode = function(callback) {
  initializeAndStartService(bitcore, callback);
}

utils.startBitcoind = function(callback) {
  initializeAndStartService(bitcoin, callback);
}

utils.unlockWallet = function(callback) {
  rpc.walletPassPhrase(walletPassphrase, 3000, function(err) {
    if(err && err.code !== -15) {
      return callback(err);
    }
    callback();
  });
}

utils.getPrivateKeysWithABalance = function(callback) {
  rpc.listUnspent(function(err, res) {
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
      rpc.dumpPrivKey(utxo.address, function(err, res) {
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
}

utils.generateSpendingTxs = function(utxos) {
  return utxos.map(function(utxo) {
    txCount++;
    var toPrivKey = new PrivateKey('testnet'); //external addresses
    var changePrivKey = new PrivateKey('testnet'); //our wallet keys
    var utxoSatoshis = Unit.fromBTC(utxo.utxo.amount).satoshis;
    var satsToPrivKey = Math.round(utxoSatoshis / 2);
    var tx = new Transaction();

    tx.from(utxo.utxo);
    tx.to(toPrivKey.toAddress().toString(), satsToPrivKey);
    tx.fee(fee);
    tx.change(changePrivKey.toAddress().toString());
    tx.sign(utxo.privKey);

    walletPrivKeys.push(changePrivKey);
    satoshisReceived += Unit.fromBTC(utxo.utxo.amount).toSatoshis() - (satsToPrivKey + fee);
    return tx;
  });
}

utils.setupInitialTxs = function(callback) {
  getPrivateKeysWithABalance(function(err, utxos) {
    if(err) {
      return callback(err);
    }
    initialTxs = generateSpendingTxs(utxos);
    callback();
  });
}

utils.sendTxs = function(callback) {
  async.eachOfSeries(initialTxs, sendTx, callback);
}

utils.sendTx = function(tx, index, callback) {
  rpc.sendRawTransaction(tx.serialize(), function(err) {
    if (err) {
      return callback(err);
    }
    var mod = index % 2;
    if (mod === 1) {
      blockHeight++;
      rpc.generate(1, callback);
    } else {
      callback();
    }
  });
}

utils.getHttpOpts = function(opts) {
  return Object.assign({
    path: opts.path,
    method: opts.method || 'GET',
    body: opts.body,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': opts.length || 0
    },
    errorFilter: opts.errorFilter
  }, bitcore.httpOpts);
}

utils.registerWallet = function(callback) {
  var httpOpts = getHttpOpts({ path: '/wallet-api/wallets/' + walletId, method: 'POST' });
  queryBitcoreNode(httpOpts, callback);
}

utils.uploadWallet = function(callback) {
  var addresses = JSON.stringify(walletPrivKeys.map(function(privKey) {
    if (privKey.privKey) {
      return privKey.pubKey.toString();
    }
    return privKey.toAddress().toString();
  }));
  var httpOpts = getHttpOpts({
    path: '/wallet-api/wallets/' + walletId + '/addresses',
    method: 'POST',
    body: addresses,
    length: addresses.length
  });
  async.waterfall([ queryBitcoreNode.bind(this, httpOpts) ], function(err, res) {
    if (err) {
      return callback(err);
    }
    var job = JSON.parse(res);

    Object.keys(job).should.deep.equal(['jobId']);

    var httpOpts = getHttpOpts({ path: '/wallet-api/jobs/' + job.jobId });

    async.retry({ times: 10, interval: 1000 }, function(next) {
      queryBitcoreNode(httpOpts, function(err, res) {
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
}

utils.getListOfTxs = function(callback) {
  var end = Date.now() + 86400000;
  var httpOpts = getHttpOpts({ path: '/wallet-api/wallets/' + walletId + '/transactions?start=0&end=' + end });
  queryBitcoreNode(httpOpts, function(err, res) {
    if(err) {
      return callback(err);
    }
    var results = [];
    res.split('\n').forEach(function(result) {
      if (result.length > 0) {
        return results.push(JSON.parse(result));
      }
    });

    var map = initialTxs.map(function(tx) {
      return tx.serialize();
    });

    results.forEach(function(result) {
      var tx = new Transaction(result);
      map.splice(map.indexOf(tx.uncheckedSerialize()), 1);
    });

    map.length.should.equal(0);
    results.length.should.equal(initialTxs.length);
    callback();
  });
}

utils.initGlobals = function() {
  walletPassphrase = 'test';
  txCount = 0;
  blockHeight = 0;
  walletPrivKeys = [];
  initialTxs = [];
  fee = 100000;
  feesReceived = 0;
  satoshisSent = 0;
  walletId = crypto.createHash('sha256').update('test').digest('hex');
  satoshisReceived = 0;
}

utils.cleanup = function(callback) {
  bitcore.process.kill();
  bitcoin.process.kill();
  setTimeout(callback, 2000);
}

module.exports = utils;
