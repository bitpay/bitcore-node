'use strict';

var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var index = require('../../');
var log = index.log;
var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
var validators = require('./validators');
var utils = require('./utils');
var _ = require('lodash');
var bodyParser = require('body-parser');
var LRU = require('lru-cache');
var Encoding = require('./encoding');

var WalletService = function(options) {
  BaseService.call(this, options);

  //TODO: what to do if we overflow jobs for which we never reported on
  //jobs are agnostic to the amount of work in each job. Additionally,
  //each job in the cache is already running immediately after setting
  //the job. This means that a large job can be started before smaller
  //jobs and this can lead to slower processing of all jobs over time.
  this._MAX_QUEUE = 1;
  this._jobs = LRU({
    max: this._MAX_QUEUE,
    maxAge: 86400000 * 3 //3 days
  });

  this._cache = LRU({
    max: 500 * 1024 * 1024,
    length: function(n) {
      return Buffer.byteLength(n, 'utf8');
    },
    maxAge: 30 * 60 * 1000
  });

  this._addressMap = {};
  this.balances = {};
};

inherits(WalletService, BaseService);

WalletService.dependencies = [
  'bitcoind',
  'web',
  'address',
  'transaction'
];

WalletService.prototype.getAPIMethods = function() {
  return [];
};

WalletService.prototype.start = function(callback) {
  var self = this;

  self.store = self.node.services.db.store;

  self.node.services.db.getPrefix(self.name, function(err, servicePrefix) {
    if(err) {
      return callback(err);
    }

    self.servicePrefix = servicePrefix;
    self._encoding = new Encoding(self.servicePrefix);

    self._loadAllAddresses(function(err) {
      if(err) {
        return callback(err);
      }

      self._loadAllBalances(callback);
    });
  });
};

WalletService.prototype.stop = function(callback) {
  setImmediate(callback);
};

WalletService.prototype.getPublishEvents = function() {
  return [];
};

WalletService.prototype.blockHandler = function(block, connectBlock, callback) {
  var self = this;

  var txs = block.transactions;

  var action = 'put';
  var reverseAction = 'del';
  if (!connectBlock) {
    action = 'del';
    reverseAction = 'put';
  }

  var operations = [];
  var walletIdsNeedingUpdate = {};

  async.eachSeries(txs, function(tx, next) {
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    for (var outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
      var output = outputs[outputIndex];

      var script = output.script;

      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      var address = self.getAddressString(script);

      if(!address || !self._addressMap[address]) {
        continue;
      }

      var walletIds = self._addressMap[address];

      for(var i = 0; i < walletIds.length; i++) {
        var walletId = walletIds[i];
        walletIdsNeedingUpdate[walletId] = true;

        operations.push({
          type: action,
          key: self._encoding.encodeWalletUtxoKey(walletId, tx.id, outputIndex),
          value: self._encoding.encodeWalletUtxoValue(block.__height, output.satoshis, output._scriptBuffer)
        });

        operations.push({
          type: action,
          key: self._encoding.encodeWalletUtxoSatoshisKey(walletId, output.satoshis, tx.id, outputIndex),
          value: self._encoding.encodeWalletUtxoSatoshisValue(block.__height, output._scriptBuffer)
        });

        if(connectBlock) {
          self.balances[walletId] += output.satoshis;
        } else {
          self.balances[walletId] -= output.satoshis;
        }
      }
    }

    if(tx.isCoinbase()) {
      return next();
    }

    //TODO deal with P2PK
    async.each(inputs, function(input, next) {
      if(!input.script) {
        log.debug('Invalid script');
        return next();
      }

      var inputAddress = self.getAddressString(input.script);

      if(!inputAddress || !self._addressMap[inputAddress]) {
        return next();
      }

      var walletIds = self._addressMap[inputAddress];

      async.each(walletIds, function(walletId, next) {
        walletIdsNeedingUpdate[walletId] = true;

        self.node.services.transaction.getTransaction(input.prevTxId, {}, function(err, tx) {
          if(err) {
            return next(err);
          }

          var utxo = tx.outputs[input.outputIndex];

          operations.push({
            type: reverseAction,
            key: self._encoding.encodeWalletUtxoKey(walletId, input.prevTxId, input.outputIndex),
            value: self._encoding.encodeWalletUtxoValue(tx.__height, utxo.satoshis, utxo._scriptBuffer)
          });

          operations.push({
            type: reverseAction,
            key: self._encoding.encodeWalletUtxoSatoshisKey(walletId, utxo.satoshis, tx.id, input.outputIndex),
            value: self._encoding.encodeWalletUtxoSatoshisValue(tx.__height, utxo._scriptBuffer)
          });

          if(connectBlock) {
            self.balances[walletId] -= output.satoshis;
          } else {
            self.balances[walletId] += output.satoshis;
          }

          next();
        });
      }, next);
    }, next);
  }, function(err) {
    if(err) {
      return callback(err);
    }

    // update balances
    for(var walletId in walletIdsNeedingUpdate) {
      operations.push({
        type: 'put',
        key: self._encoding.encodeWalletBalanceKey(walletId),
        value: self._encoding.encodeWalletBalanceValue(self.balances[walletId])
      });
    }

    callback(null, operations);
  });
};

WalletService.prototype.getAddressString = function(script, output) {
  var address = script.toAddress();
  if(address) {
    return address.toString();
  }

  try {
    var pubkey = script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {
    //log.warn('Error getting public key from: ', script.toASM(), script.toHex());
    // if there is an error, it's because a pubkey can not be extracted from the script
    // continue on and return null
  }

  //TODO add back in P2PK, but for this we need to look up the utxo for this script
  if(output && output.script && output.script.isPublicKeyOut()) {
    return output.script.getPublicKey().toString('hex');
  }

  //log.warn('No utxo given for script spending a P2PK: ', script.toASM(), script.toHex());
  return null;
};

WalletService.prototype.concurrentBlockHandler = function(block, connectBlock, callback) {
  var self = this;

  var txs = block.transactions;

  var action = 'put';
  if (!connectBlock) {
    action = 'del';
  }

  var operations = [];

  for(var i = 0; i < txs.length; i++) {
    var tx = txs[i];
    var inputs = tx.inputs;
    var outputs = tx.outputs;

    for (var outputIndex = 0; outputIndex < outputs.length; outputIndex++) {
      var output = outputs[outputIndex];

      var script = output.script;

      if(!script) {
        log.debug('Invalid script');
        continue;
      }

      var address = self.node.services.address.getAddressString(script);

      if(!address || !self._addressMap[address]) {
        continue;
      }

      var walletIds = self._addressMap[address];

      for(var j = 0; j < walletIds.length; j++) {
        var walletId = walletIds[j];
        operations.push({
          type: action,
          key: self._encoding.encodeWalletTransactionKey(walletId, block.__height),
          value: self._encoding.encodeWalletTransactionValue(tx.id)
        });
      }
    }

    if(tx.isCoinbase()) {
      continue;
    }

    //TODO deal with P2PK
    for(var inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
      var input = inputs[inputIndex];

      if(!input.script) {
        log.debug('Invalid script');
        continue;
      }

      var inputAddress = self.getAddressString(input.script);

      if(!inputAddress || !self._addressMap[inputAddress]) {
        continue;
      }

      var inputWalletIds = self._addressMap[inputAddress];

      for(var k = 0; k < inputWalletIds.length; k++) {
        var inputWalletId = inputWalletIds[inputIndex];
        operations.push({
          type: action,
          key: self._encoding.encodeWalletTransactionKey(inputWalletId, block.__height),
          value: self._encoding.encodeWalletTransactionValue(tx.id)
        });
      }
    }
  }
  setImmediate(function() {
    callback(null, operations);
  });
};

WalletService.prototype._loadAllAddresses = function(callback) {
  var self = this;

  self._addressMap = {};

  var start = self._encoding.encodeWalletAddressesKey('00');
  var end = self._encoding.encodeWalletAddressesKey(Array(65).join('f'));

  var stream = self.store.createReadStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(data) {
    var key = self._encoding.decodeWalletAddressesKey(data.key);
    var value = self._encoding.decodeWalletAddressesValue(data.value);
    value.forEach(function(address) {
      if(!self._addressMap[address]) {
        self._addressMap[address] = [];
      }

      self._addressMap[address].push(key);
    });
  });

  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('end', function() {
    callback(streamErr);
  });
};

WalletService.prototype._loadAllBalances = function(callback) {
  var self = this;

  self._balances = {};

  var start = self._encoding.encodeWalletBalanceKey('00');
  var end = self._encoding.encodeWalletBalanceKey(Array(65).join('f'));

  var stream = self.store.createReadStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(data) {
    var walletId = self._encoding.decodeWalletBalanceKey(data.key);
    var balance = self._encoding.decodeWalletBalanceValue(data.value);

    self._balances[walletId] = balance;
  });

  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('end', function() {
    callback(streamErr);
  });
};


WalletService.prototype._endpointUTXOs = function() {
  var self = this;
  return function(req, res) {
    req.setTimeout(600000);
    var walletId = req.params.walletId;
    var queryMempool = req.query.queryMempool !== false;
    var height = null;
    var options = {
      queryMempool: queryMempool
    };
    self._getUtxos(walletId, options, function(err, utxos) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(200).jsonp({
        utxos: utxos,
        height: height
      });
    });
  };
};

WalletService.prototype._endpointGetBalance= function() {
  var self = this;
  return function(req, res) {
    req.setTimeout(600000);
    var walletId = req.params.walletId;
    var queryMempool = req.query.queryMempool !== false;
    var byAddress = req.query.byAddress;

    var height = null;

    var options = {
      queryMempool: queryMempool,
      byAddress: byAddress
    };

    self._getBalance(walletId, options, function(err, result) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(200).jsonp(result);
    });
  };
};

WalletService.prototype._endpointRemoveWallet = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;

    self._removeWallet(walletId, function(err, numRecords) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(200).jsonp({
        walletId: walletId,
        numberRemoved: numRecords
      });
    });
  };
};

WalletService.prototype._endpointGetAddresses = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;

    self._getAddresses(walletId, function(err, addresses) {
      if(err) {
        return utils.sendError(err, res);
      }

      if(!addresses) {
        return res.status(404).send('Not found');
      }

      res.status(200).jsonp({
        addresses: addresses
      });
    });
  };
};

WalletService.prototype._endpointDumpAllWallets = function() {
  var self = this;
  return function(req, res) {
    var keys = [];

    var start = new Buffer(self.servicePrefix);
    var end = new Buffer.concat([start, new Buffer('ff', 'hex')]);

    var stream = self.store.createKeyStream({
      gte: start,
      lt: end
    });

    var streamErr = null;
    stream.on('error', function(err) {
      streamErr = err;
    });

    stream.on('data', function(data) {
      keys.push(data);
    });

    stream.on('end', function() {
      if(streamErr) {
        return utils.sendError(streamErr, res);
      }
      var resultsMap = keys.map(function(key) {
        return key.toString('hex');
      });
      res.status(200).jsonp({
        result: resultsMap
      });
    });
  };
};

WalletService.prototype._endpointGetWalletIds = function() {
  var self = this;
  return function(req, res) {
    var start = new Buffer.concat([self.servicePrefix, new Buffer(self._encoding.subKeyMap.addresses.buffer)]);
    var end = new Buffer.concat([start, new Buffer('ff', 'hex')]);
    var stream = self.store.createKeyStream({
      gte: start,
      lt: end
    });
    var walletIds = [];
    var streamErr;
    stream.on('error', function(err) {
      var streamErr = err;
    });
    stream.on('data', function(data) {
      walletIds.push(self._encoding.decodeWalletAddressesKey(data));
    });
    stream.on('end', function() {
      if(streamErr) {
        return utils.sendError(streamErr, res);
      }
      res.status(200).jsonp({
        walletIds: walletIds
      });
    });
  };
};

WalletService.prototype._endpointRegisterWallet = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;
    if (!walletId)  {
      walletId = utils.getWalletId();
    }
    self._createWallet(walletId, function(err) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(201).jsonp({
        walletId: walletId
      });
    });
  };
};

WalletService.prototype._endpointPostAddresses = function() {
  var self = this;
  return function(req, res) {
    var addresses = req.addresses;
    if (!addresses || !addresses.length) {
      return utils.sendError(new Error('addresses are required when creating a wallet.'), res);
    }
    var walletId = req.params.walletId; //also can't be zero
    if (!walletId) {
      return utils.sendError(new Error('WalletId must be given.'), res);
    }
    // TODO make imdempotent
    //this could be a long-running operation, so we'll return a job id
    if (!self._isJobQueueReady()) {
      return callback(new Error('Job queue is currently overloaded, please try again later.'), jobResults);
    }

    var jobId = utils.generateJobId();
    self._importAddresses(walletId, addresses, jobId, self._jobCompletionCallback.bind(self));
    res.status(200).jsonp({jobId: jobId});
  };
};

WalletService.prototype._endpointGetTransactions = function() {
  var self = this;
  return function(req, res) {
    req.setTimeout(600000);
    var walletId = req.params.walletId;
    var options = {
      start: req.query.start,
      end : req.query.end,
      from: req.query.from,
      to: req.query.to
    };
    self._getTransactions(walletId, options, function(err, transactions, totalCount) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(200).jsonp({
        transactions: transactions,
        totalCount: totalCount
      });
    });
  };
};

WalletService.prototype._endpointPutAddresses = function() {
  var self = this;
  return function(req, res) {
    if (!self._isJobQueueReady()) {
      return utils.sendError(new Error('Job Queue is full, current job limit: ' + self._MAX_QUEUE), res);
    }

    var newAddresses = req.body;

    if(!Array.isArray(req.body)) {
      return utils.sendError(new Error('Must PUT an array'), res);
    }

    var walletId = req.params.walletId;
    if (!walletId) {
      return utils.sendError(new Error('WalletId must be given.'), res);
    }

    self._getAddresses(walletId, function(err, oldAddresses) {
      if(err) {
        return utils.sendError(err, res);
      }

      if(!oldAddresses) {
        return res.status(404).send('Not found');
      }

      var addAddresses = _.without(newAddresses, oldAddresses);
      var amountAdded = addAddresses.length;

      var jobId = utils.generateJobId();
      self._importAddresses(walletId, addAddresses, jobId, self._jobCompletionCallback.bind(self));
      res.status(200).jsonp({jobId: jobId});
    });
  };
};

WalletService.prototype._getUtxos = function(walletId, options, callback) {
  var self = this;

  var stream = self.store.createReadStream({
    gte: self._encoding.encodeWalletUtxoKey(walletId),
    lt: self._encoding.encodeWalletUtxoKey(utils.getTerminalKey(new Buffer(walletId)))
  });

  var utxos = [];
  var streamErr = null;

  stream.on('data', function(data) {
    var key = self._encoding.decodeWalletUtxoKey(data.key);
    var value = self._encoding.decodeWalletUtxoValue(data.value);

    utxos.push({
      txid: key.txid,
      vout: key.outputIndex,
      height: value.height,
      satoshis: value.satoshis,
      scriptPubKey: value.script._scriptBuffer
    });
  });

  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('end', function() {
    callback(streamErr, utxos);
  });
};

WalletService.prototype._getBalance = function(walletId, options, callback) {
  var self = this;

  var key = self._encoding.encodeWalletBalanceKey(walletId);

  self.store.get(key, function(err, buffer) {
    if(err) {
      return callback(err);
    }

    callback(null, self._encoding.decodeWalletBalanceValue(buffer));
  });
};

WalletService.prototype._chunkAdresses = function(addresses) {
  var maxLength = this.node.services.bitcoind.maxAddressesQuery;
  var groups = [];
  var groupsCount = Math.ceil(addresses.length / maxLength);
  for(var i = 0; i < groupsCount; i++) {
    groups.push(addresses.slice(i * maxLength, Math.min(maxLength * (i + 1), addresses.length)));
  }
  return groups;
};

WalletService.prototype._getTransactions = function(walletId, options, callback) {
  var self = this;
  var txids = [];
  var opts = {
    start: options.start || 0,
    end: options.end || Math.pow(2, 32) - 1
  };
  var key = walletId + opts.start + opts.end;
  var transactions;

  function finish(transactions) {
    var from = options.from || 0;
    var to = options.to || transactions.length;
    if (!options.queryMempool) {
      return callback(null, transactions.slice(from, to), transactions.length);
    }
    self._getAddresses(walletId, function(err, addresses) {
      if(err) {
        return callback(err);
      }
      self.mempool.getTransactionsByAddresses(addresses, function(err, mempoolTxs) {
        if(err) {
          return callback(err);
        }
        transactions = transactions.concat(mempoolTxs);
        callback(null, transactions.slice(from, to), transactions.length);
      });
    });
  }

  if (!self._cache.peek(key)) {
    var stream = self.store.createReadStream({
      gte: self._encoding.encodeWalletTransactionKey(walletId, opts.start),
      lt: self._encoding.encodeWalletTransactionKey(walletId, opts.end)
    });

    var streamErr;
    stream.on('error', function(err) {
      streamErr = err;
    });

    stream.on('data', function(data) {
      txids.push(self._encoding.decodeWalletTransactionValue(data.value));
    });

    stream.on('end', function() {
      async.mapLimit(txids, function(txid, next) {
        self.node.services.transaction.getTransaction(txid, options, next);
      }, function(err, transactions) {
        if(err) {
          return callback(err);
        }
        self._cache.set(key, JSON.stringify(transactions));
        finish(transactions);
      });
    });
  } else {
    try {
      transactions = JSON.parse(self._cache.get(key));
      finish(transactions);
    } catch(e) {
      self._cache.del(key);
      return callback(e);
    }
  }
};

WalletService.prototype._removeWallet = function(walletId, callback) {
  var self = this;
  async.map(Object.keys(self._encoding.subKeyMap), function(prefix, next) {
    var keys = [];

    var start = self._encoding.subKeyMap[prefix].fn.call(self._encoding, walletId);
    var end = new Buffer.concat([self._encoding.subKeyMap[prefix].fn.call(self._encoding, walletId), new Buffer('ff', 'hex')]);

    var stream = self.store.createKeyStream({
      gte: start,
      lt: end
    });

    var streamErr = null;
    stream.on('error', function(err) {
      streamErr = err;
    });

    stream.on('data', function(data) {
      keys.push(data);
    });

    stream.on('end', function() {
      next(streamErr, keys);
    });

  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    results = _.flatten(results);
    var operations = [];
    for(var i = 0; i < results.length; i++) {
      operations.push({
        type: 'del',
        key: results[i]
      });
    }
    self.store.batch(operations, function(err) {
      if(err) {
        return callback(err);
      }
      callback(null, operations.length);
    });
  });
};

WalletService.prototype._getAddresses = function(walletId, callback) {
  var self = this;
  var key = self._encoding.encodeWalletAddressesKey(walletId);
  self.store.get(key, function(err, value) {
    if(err) {
      return callback(err);
    }
    if (!value) {
      return callback(null, []);
    }
    callback(null, self._encoding.decodeWalletAddressesValue(value));
  });
};

WalletService.prototype._createWallet = function(walletId, callback) {
  var self = this;
  var key = self._encoding.encodeWalletAddressesKey(walletId);
  self.store.get(key, function(err) {
    if (err && ((/notfound/i).test(err) || err.notFound)) {
      var value = self._encoding.encodeWalletAddressesValue([]);
      return self.store.put(key, value, callback);
    }
    callback();
  });
};

WalletService.prototype._isJobQueueReady = function() {

  var self = this;

  self._jobs.rforEach(function(value, key) {
    if ((value.state === 'complete' || value.state === 'error') && value.reported) {
      self._jobs.del(key);
    }
  });

  return self._jobs.length < self._MAX_QUEUE;

};

WalletService.prototype._jobCompletionCallback = function(err, results) {
  log.info('Completed job: ', results.jobId);

  var jobId = results.jobId;
  var job = this._jobs.get(jobId);

  if (!job) {
    log.debug('ERROR: Could not locate job id: ' + jobId +
      ' in the list of jobs. It may have been purged already although it should not have.');
    return;
  }

  job.progress = 1.0;
  job.endtime = Date.now();

  if (err) {
    job.status = 'error';
    job.message = err.message;
    return;
  }

  job.status = 'complete';
  job.message = results;
  job.reported = false;
};

//TODO: if this is running as a job, then the whole process can be moved to another CPU
WalletService.prototype._importAddresses = function(walletId, addresses, jobId, callback) {
  var self = this;

  var jobResults = { jobId: jobId };

  var job = {
    starttime: Date.now(),
    fn: 'importAddresses',
    progress: 0,
    projectedendtime: null
  };

  this._jobs.set(jobId, job);

  self._getAddresses(walletId, function(err, oldAddresses) {
    if(err) {
      return callback(err, jobResults);
    }

    async.parallel(
      [
        self._getUTXOIndexOperations.bind(self, walletId, addresses, jobId),
        self._getTxidIndexOperations.bind(self, walletId, addresses, jobId)
      ],
      function(err, results) {
        if(err) {
          return callback(err, jobResults);
        }

        var now = Date.now();
        job.progress = 0.50;
        job.projectedendtime = now + (now - job.starttime);

        var operations = results[0].concat(results[1]);
        operations.push({
          type: 'put',
          key: self._encoding.encodeWalletAddressesKey(walletId),
          value: self._encoding.encodeWalletAddressesValue(oldAddresses.concat(addresses))
        });

        self.store.batch(operations, function(err) {
          if(err) {
            return callback(err, jobResults);
          }

          self._loadAllAddresses(function(err) {
            if(err) {
              return callback(err, jobResults);
            }

            self._loadAllBalances(function(err) {
              if(err) {
                return callback(err, jobResults);
              }
              callback(null, jobResults);
            });
          });
        });
      }
    );
  });
};

WalletService.prototype._getUTXOIndexOperations = function(walletId, addresses, jobId, callback) {
  var self = this;

  var balance = 0;

  self._getBalance(walletId, {}, function(err, initialBalance) {
    if(err && !err.notFound) {
      return callback(err);
    }

    if(initialBalance) {
      balance = initialBalance;
    }

    self.node.services.address.getUtxos(addresses, false, function(err, utxos) {
      if(err) {
        return callback(err);
      }

      var operations = [];

      for(var i = 0; i < utxos.length; i++) {
        var utxo = utxos[i];

        balance += utxo.satoshis;

        operations.push({
          type: 'put',
          key: self._encoding.encodeWalletUtxoKey(walletId, utxo.txid, utxo.outputIndex),
          value: self._encoding.encodeWalletUtxoValue(utxo.height, utxo.satoshis, utxo.script)
        });

        operations.push({
          type: 'put',
          key: self._encoding.encodeWalletUtxoSatoshisKey(walletId, utxo.satoshis, utxo.txid, utxo.outputIndex),
          value: self._encoding.encodeWalletUtxoSatoshisValue(utxo.height, utxo.script)
        });
      }

      operations.push({
        type: 'put',
        key: self._encoding.encodeWalletBalanceKey(walletId),
        value: self._encoding.encodeWalletBalanceValue(balance)
      });

      callback(null, operations);
    });
  });
};

WalletService.prototype._getTxidIndexOperations = function(walletId, addresses, jobId, callback) {
  var self = this;

  var txids = {};

  async.eachLimit(addresses, 10, function(address, next) {
    self.node.services.address.getAddressTxidsWithHeights(address, {}, function(err, tmpTxids) {
      if(err) {
        return next(err);
      }

      txids = _.merge(txids, tmpTxids);
      return next();
    });
  }, function(err) {
    if(err) {
      return callback(err);
    }

    var operations = Object.keys(txids).map(function(txid) {
      return {
        type: 'put',
        key: self._encoding.encodeWalletTransactionKey(walletId, txids[txid]),
        value: self._encoding.encodeWalletTransactionValue(txid)
      };
    });

    callback(null, operations);
  });
};

WalletService.prototype._storeAddresses = function(walletId, addresses, callback) {
  var key = this._encoding.encodeWalletAddressesKey(walletId);
  var value = this._encoding.encodeWalletValue(addresses);
  this.store.put(key, value, callback);
};

WalletService.prototype._storeBalance = function(walletId, balance, callback) {
  var key = this._encoding.encodeWalletBalanceKey(walletId);
  var value = this._encoding.encodeWalletBalanceValue(balance);
  this.store.put(key, value, callback);
};

WalletService.prototype._endpointJobs = function() {

  var self = this;

  return function(req, res) {

    var count = 0;
    self._jobs.rforEach(function(value, key) {
      if ((value.state === 'complete' || value.state === 'error') && value.reported) {
        count++;
      }
    });

    res.status(200).jsonp({ jobCount: self._jobs.length - count });
  };

};

WalletService.prototype._endpointJobStatus = function() {

  var self = this;

  return function(req, res) {
    var jobId = req.params.jobId;
    var job = self._jobs.get(jobId);
    if (!jobId || !job) {
      return utils.sendError(new Error('Job not found. ' +
      'The job results may have been purged to make room for new jobs.'), res);
    }
    job.reported = true;
    return  res.status(201).jsonp(job);
  };

};

WalletService.prototype._endpointGetInfo = function() {
  return function(req, res) {
    res.jsonp({result: 'ok'});
  };
};

WalletService.prototype.setupRoutes = function(app) {
  var s = this;
  var v = validators;

  app.use(bodyParser.json());

  app.get('/info',
    s._endpointGetInfo()
  );
  app.get('/wallets/:walletId/utxos',
    s._endpointUTXOs()
  );
  app.get('/wallets/:walletId/balance',
    s._endpointGetBalance()
  );
  app.get('/wallets/dump',
    s._endpointDumpAllWallets()
  );
  app.get('/wallets/:walletId',
    s._endpointGetAddresses()
  );
  app.post('/wallets/:walletId',
    s._endpointRegisterWallet()
  );
  app.delete('/wallets/:walletId',
    s._endpointRemoveWallet()
  );
  app.put('/wallets/:walletId/addresses',
    s._endpointPutAddresses()
  );
  app.post('/wallets/:walletId/addresses',
    upload.single('addresses'),
    v.checkAddresses,
    s._endpointPostAddresses()
  );
  app.get('/wallets/:walletId/transactions',
    s._endpointGetTransactions()
  );
  app.get('/wallets',
    s._endpointGetWalletIds()
  );
  app.get('/jobs/:jobId',
    s._endpointJobStatus()
  );
  app.get('/jobs',
    s._endpointJobs()
  );
};

WalletService.prototype.getRoutePrefix = function() {
  return 'wallet-api';
};

module.exports = WalletService;

