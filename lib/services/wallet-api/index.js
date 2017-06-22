'use strict';

var async = require('async');
var assert = require('assert');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var index = require('../../');
var log = index.log;
var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
var validators = require('./validators');
var mainUtils = require('../../utils');
var utils = require('./utils');
var _ = require('lodash');
var bodyParser = require('body-parser');
var LRU = require('lru-cache');
var Encoding = require('./encoding');
var bitcore = require('bitcore-lib');
var Input = bitcore.Transaction.Input;
var Unit = bitcore.Unit;
var Transform = require('stream').Transform;

var WalletService = function(options) {
  BaseService.call(this, options);

  this._MAX_QUEUE = 20;
  this._jobs = LRU({
    max: this._MAX_QUEUE,
    maxAge: 86400000 * 3 //3 days
  });

  this._addressMap = {};
  this.balances = {};

  this.db = this.node.services.db;
};

inherits(WalletService, BaseService);

WalletService.dependencies = [
  'web',
  'address',
  'transaction',
  'timestamp'
];

WalletService.prototype.getAPIMethods = function() {
  return [];
};

WalletService.prototype.start = function(callback) {
  var self = this;


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

      self.setListeners();
      self._loadAllBalances(callback);
    });

  });
};

WalletService.prototype._setListeners = function() {
  this._startSubscriptions();
};

WalletService.prototype._startSubscriptions = function() {

  var self = this;

  if (self._subscribed) {
    return;
  }

  self._subscribed = true;
  self.bus = self.node.openBus({remoteAddress: 'localhost'});

  self.bus.on('block/block', self._onBlock.bind(self));
  self.bus.subscribe('block/block');
};

WalletService.prototype._onBlock = function(block) {
};

WalletService.prototype.stop = function(callback) {
  setImmediate(callback);
};

WalletService.prototype.getPublishEvents = function() {
  return [];
};


WalletService.prototype.getAddressString = function(io) {

  var address = io.script.toAddress(this.node.network);

  if(address) {
    return address.toString();
  }

  try {
    var pubkey = io.script.getPublicKey();
    if(pubkey) {
      return pubkey.toString('hex');
    }
  } catch(e) {}

};

WalletService.prototype._checkAddresses = function() {
  return Object.keys(this._addressMap).length > 0;
};

  var self = this;

  self._addressMap = {};

  var start = self._encoding.encodeWalletAddressesKey('00');
  var end = self._encoding.encodeWalletAddressesKey(Array(65).join('f'));

  var stream = self.db.createReadStream({
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

  var stream = self.db.createReadStream({
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
    var height = self.node.services.db.tip.__height;
    var options = {
      queryMempool: queryMempool
    };
    self.db.pauseSync(function() {
      self._getUtxos(walletId, options, function(err, utxos) {
        if(err) {
          return utils.sendError(err, res);
        }
        self.db.resumeSync();
        res.status(200).jsonp({
          utxos: utxos,
          height: height
        });
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

    var options = {
      queryMempool: queryMempool,
      byAddress: byAddress
    };

    self.db.pauseSync(function() {
      self._getBalance(walletId, options, function(err, result) {
        if(err) {
          return utils.sendError(err, res);
        }
        self.db.resumeSync();
        res.status(200).jsonp({
          satoshis: result,
          height: self.node.services.db.tip.__height,
          hash: self.node.services.db.tip.hash
        });
      });
    });
  };
};

WalletService.prototype._endpointRemoveWallet = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;

    self.db.pauseSync(function() {
      self._removeWallet(walletId, function(err, numRecords) {
        if(err) {
          return utils.sendError(err, res);
        }
        self.db.resumeSync();
        res.status(200).jsonp({
          walletId: walletId,
          numberRemoved: numRecords
        });
      });
    });
  };
};

WalletService.prototype._endpointRemoveAllWallets = function() {
  var self = this;
  return function(req, res) {

    self.db.pauseSync(function() {
      self._removeAllWallets(function(err, numRecords) {
        if(err) {
          return utils.sendError(err, res);
        }
        self.db.resumeSync();
        res.status(200).jsonp({
          numberRemoved: numRecords
        });
      });
    });
  };
};

WalletService.prototype._endpointGetAddresses = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;

    self.db.pauseSync(function() {
      self._getAddresses(walletId, function(err, addresses) {
        self.db.resumeSync();
        if(err) {
          return utils.sendError(err, res);
        }

        if(!addresses) {
          return res.status(404).send('Not found');
        }

        res.status(200).jsonp({
          addresses: addresses.length
        });
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

    var stream = self.db.createKeyStream({
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
    var stream = self.db.createKeyStream({
      gte: start,
      lt: end
    });
    var walletIds = [];

    var streamErr;
    stream.on('error', function(err) {
      streamErr = err;
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

WalletService.prototype._endpointResyncAddresses = function() {

  var self = this;

  return function(req, res) {
    var walletId = req.params.walletId;


    if (!walletId) {
      return utils.sendError(new Error('WalletId must be given.'), res);
    }

    if (!self._isJobQueueReady()) {
      return utils.sendError(new Error('Job queue is currently overloaded, please try again later.'), res);
    }

    self.db.pauseSync(function() {

      self._getAddresses(walletId, function(err, oldAddresses) {

        if(err) {
          return utils.sendError(err, res);
        }

        if(!oldAddresses) {
          return res.status(404).send('Not found');
        }

        self._removeWallet(walletId, function(err) {

          if(err) {
            return utils.sendError(err, res);
          }

          self._createWallet(walletId, function() {

            var jobId = utils.generateJobId();
            self._importAddresses(walletId, oldAddresses, jobId, self._jobCompletionCallback.bind(self));
            res.status(200).jsonp({jobId: jobId});

          });
        });
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
    var walletId = req.params.walletId;
    if (!walletId) {
      return utils.sendError(new Error('WalletId must be given.'), res);
    }
    if (!self._isJobQueueReady()) {
      return utils.sendError(new Error('Job queue is currently overloaded, please try again later.'), res);
    }

    var jobId = utils.generateJobId();

    self.db.pauseSync(function() {

      self._importAddresses(walletId, addresses, jobId, self._jobCompletionCallback.bind(self));
      res.status(200).jsonp({jobId: jobId});

    });
  };
};

WalletService.prototype._endpointGetTransactions = function() {

  var self = this;

  return function(req, res) {

    var walletId = req.params.walletId;

    self.db.pauseSync(function() {
      self._processStartEndOptions(req, function(err, heights) {

        if(err) {
          return utils.sendError(err, res);
        }

        var options = {
          start: heights[0] || 0,
          end : heights[1] || 0xffffffff,
          self: self,
          walletId: walletId
        };

        var missingTxidCount = 0;
        var transform = new Transform({ objectMode: true, highWaterMark: 1000000 });
        //txids are sent in and the actual tx's are found here
        transform._transform = function(chunk, enc, callback) {

          var txid = self._encoding.decodeWalletTransactionKey(chunk).txid.toString('hex');

	  if (txid.length !== 64 || txid === '0000000000000000000000000000000000000000000000000000000000000000') {
            missingTxidCount++;
	    log.error('missingTxidCount: ', missingTxidCount);
	    return callback();
          }

          self._getTransactionFromDb(options, txid, function(err, tx) {

            if(err) {
              log.error(err);
	      transform.unpipe();
              return callback();
            }

            var formattedTx = utils.toJSONL(self._formatTransaction(tx));
            transform.push(formattedTx);
            callback();

          });

        };

        transform._flush = function(callback) {
          self.db.resumeSync();
          callback();
        };

        var encodingFn = self._encoding.encodeWalletTransactionKey.bind(self._encoding);
        var stream = self.db.createKeyStream(self._getSearchParams(encodingFn, options));

	stream.on('close', function() {
	  stream.unpipe();
	});

        stream.pipe(transform).pipe(res);
      });
    });
  };
};

WalletService.prototype._formatTransactions = function(txs) {
  return txs.forEach(this._formatTransaction);
};

WalletService.prototype._formatTransaction = function(tx) {
  var obj = tx.toObject();

  for(var i = 0; i < tx.inputs.length; i++) {
    obj.inputs[i].inputSatoshis = tx.__inputValues[i];
  }
  obj.height = tx.__height;
  obj.timestamp = tx.__timestamp;
  return obj;
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

    self.db.pauseSync(function() {

      self._getAddresses(walletId, function(err, oldAddresses) {

        if(err) {
          return utils.sendError(err, res);
        }

        if(!oldAddresses) {
          return res.status(404).send('Not found');
        }

        var addAddresses = _.without(newAddresses, oldAddresses);

        var jobId = utils.generateJobId();
        self._importAddresses(walletId, addAddresses, jobId, self._jobCompletionCallback.bind(self));
        res.status(200).jsonp({jobId: jobId});

      });
    });

  };
};

WalletService.prototype._getUtxos = function(walletId, options, callback) {
  var self = this;

  var stream = self.db.createReadStream({
    gte: self._encoding.encodeWalletUtxoKey(walletId),
    lt: self._encoding.encodeWalletUtxoKey(mainUtils.getTerminalKey(new Buffer(walletId)))
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
      scriptPubKey: value.script.toString('hex')
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

  self.db.get(key, function(err, buffer) {

    if(err) {
      return callback(err);
    }

    callback(null, self._encoding.decodeWalletBalanceValue(buffer));
  });

};

WalletService.prototype._getSearchParams = function(fn, options) {
    return {
      gte: fn.call(this, options.walletId, options.start),
      lt: Buffer.concat([ fn.call(this, options.walletId, options.end).slice(0, -32), new Buffer('ff', 'hex') ])
    };
};

WalletService.prototype._getTransactionFromDb = function(options, txid, callback) {

  var self = options.self;

  self.node.services.transaction.getTransaction(txid.toString('hex'), options, function(err, tx) {

    if(err) {
      return callback(err);
    }

    if (tx.__inputValues) {
      return callback(null, tx);
    }

    async.mapLimit(tx.inputs, 8, function(input, next) {

      self.node.services.transaction.getTransaction(input.prevTxId.toString('hex'), options, function(err, tx) {

        if(err) {
          return next(err);
        }

        next(null, tx.outputs[input.outputIndex].satoshis);
      });

    }, function(err, inputValues) {

      if(err) {
        return callback(err);
      }

      tx.__inputValues = inputValues;
      callback(null, tx);

    });
  });

};

WalletService.prototype._removeWallet = function(walletId, callback) {

  var self = this;
  async.map(Object.keys(self._encoding.subKeyMap), function(prefix, next) {

    var keys = [];

    var start = self._encoding.subKeyMap[prefix].fn.call(self._encoding, walletId);
    var end = new Buffer.concat([
      self._encoding.subKeyMap[prefix]
        .fn.call(self._encoding, walletId),
      new Buffer('ff', 'hex')]);

    var stream = self.db.createKeyStream({
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
    self.db.batch(operations, function(err) {
      if(err) {
        return callback(err);
      }
      callback(null, operations.length);
    });
  });
};

WalletService.prototype._removeAllWallets = function(callback) {
  var self = this;
  var operations = [];

  var start = self._encoding.servicePrefix;
  var end = new Buffer.concat([ start, new Buffer('ff', 'hex') ]);

  var stream = self.db.createKeyStream({
    gte: start,
    lte: end
  });

  var streamErr = null;
  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('data', function(data) {
    operations.push({ type: 'del', key: data });
  });

  stream.on('end', function() {
    self.db.batch(operations, function(err) {
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
  self.db.get(key, function(err, value) {
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
  self.db.get(key, function(err) {
    if (err && ((/notfound/i).test(err) || err.notFound)) {
      var value = self._encoding.encodeWalletAddressesValue([]);
      return self.db.put(key, value, callback);
    }
    callback();
  });
};

WalletService.prototype._isJobQueueReady = function() {

  var self = this;

  self._jobs.rforEach(function(value, key) {
    if ((value.status === 'complete' || value.status === 'error') && value.reported) {
      self._jobs.del(key);
    }
  });

  return self._jobs.length < self._MAX_QUEUE;

};

WalletService.prototype._jobCompletionCallback = function(err, results) {

  this.db.resumeSync();

  log.info('Completed job: ', results.jobId);

  var jobId = results.jobId;
  var job = this._jobs.get(jobId);

  if (!job) {
    log.error('ERROR: Could not locate job id: ' + jobId +
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

    log.info('loaded existing addresses, count: ', oldAddresses.length);
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

        self.db.batch(operations, function(err) {
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

    log.info('Initial balance of walletId: ' + walletId + ' is: ' + Unit.fromSatoshis(balance).toBTC() + ' BTC.');
    log.info('Starting to gather utxos for walletId: ' + walletId);
    self.node.services.address.getUtxos(addresses, false, function(err, utxos) {
      if(err) {
        return callback(err);
      }

      log.info('completed gathering utxos: ', utxos.length);
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

      log.info('Final balance for walletId: ' + walletId + ' is: ' + Unit.fromSatoshis(balance).toBTC() + ' BTC.');
      callback(null, operations);
    });
  });
};

WalletService.prototype._getTxidIndexOperations = function(walletId, addresses, jobId, callback) {
  var self = this;
  var txids = {};

  var logCount = 0;
  async.eachLimit(addresses, 10, function(address, next) {
    self.node.services.address.getAddressTxidsWithHeights(address, null, function(err, tmpTxids) {
      if(err) {
        return next(err);
      }
      if (logCount++ % 1000 === 0) {
        log.info('loaded address txids, total count: ', Object.keys(txids).length);
      }
      txids = _.merge(txids, tmpTxids);
      return next();
    });
  }, function(err) {
    if(err) {
      return callback(err);
    }

    var operations = Object.keys(txids).map(function(txid) {
      assert(txid.length === 64, 'WalletService, Txid: ' + txid + ' with length: ' + txid.length + ' does not resemble a txid.');
      return {
        type: 'put',
        key: self._encoding.encodeWalletTransactionKey(walletId, txids[txid], txid)
      };
    });

    callback(null, operations);
  });
};

WalletService.prototype._storeAddresses = function(walletId, addresses, callback) {
  var key = this._encoding.encodeWalletAddressesKey(walletId);
  var value = this._encoding.encodeWalletValue(addresses);
  this.db.put(key, value, callback);
};

WalletService.prototype._storeBalance = function(walletId, balance, callback) {
  var key = this._encoding.encodeWalletBalanceKey(walletId);
  var value = this._encoding.encodeWalletBalanceValue(balance);
  this.db.put(key, value, callback);
};

WalletService.prototype._processStartEndOptions = function(req, callback) {
  var self = this;

  if (req.query.start >= 0 && req.query.end >= 0) {

    var heights = [];
    self.node.services.timestamp.getBlockHeights([
      utils.normalizeTimeStamp(req.query.start),
      utils.normalizeTimeStamp(req.query.end)
    ],

    function(err, hashTuple) {
      if(err) {
        return callback(err);
      }

      hashTuple.forEach(function(hash) {
        self.node.services.bitcoind._tryAllClients(function(client, done) {
          client.getBlock(hash, function(err, response) {
            if (err) {
              return callback(err);
            }
            done(null, heights.push(response.result.height));
          });
        }, function(err) {
          if(err) {
            return callback(err);
          }
          if (heights.length > 1) {
            callback(null, heights);
          }
        });
      });
    });
  } else {

    setImmediate(function() {
      callback(null, [req.query.start, req.query.end]);
    });

  }
};

WalletService.prototype._endpointJobs = function() {

  var self = this;

  return function(req, res) {

    var count = 0;
    self._jobs.rforEach(function(value) {
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

WalletService.prototype._setupReadOnlyRoutes = function(app) {
  var s = this;

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

WalletService.prototype._setupWriteRoutes = function(app) {
  var s = this;
  var v = validators;

  app.post('/wallets/:walletId',
    s._endpointRegisterWallet()
  );
  app.delete('/wallets/:walletId',
    s._endpointRemoveWallet()
  );
  app.delete('/wallets/',
    s._endpointRemoveAllWallets()
  );
  app.put('/wallets/:walletId/addresses',
    s._endpointPutAddresses()
  );
  app.post('/wallets/:walletId/addresses',
    upload.single('addresses'),
    v.checkAddresses,
    s._endpointPostAddresses()
  );
  app.put('/wallets/:walletId/addresses/resync',
    s._endpointResyncAddresses()
  );
};


WalletService.prototype.setupRoutes = function(app) {

  app.use(bodyParser.json());
  this._setupReadOnlyRoutes(app);
  this._setupWriteRoutes(app);

};

WalletService.prototype.getRoutePrefix = function() {
  return 'wallet-api';
};

module.exports = WalletService;

