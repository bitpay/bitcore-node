'use strict';

var async = require('async');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var Networks = bitcore.Networks;
var levelup = require('levelup');
var leveldown  = require('leveldown');
var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
var validators = require('./validators');
var utils = require('./utils');
var _ = require('lodash');
var bodyParser = require('body-parser');
var LRU = require('lru-cache');
var Encoding = require('../../encoding'); // TODO this needs to be split out by service


var WalletService = function(options) {
  BaseService.call(this, options);

  this._cache = LRU({
    max: 500 * 1024 * 1024,
    length: function(n, key) {
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
  'web'
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

      var address = self.services.address.getAddressString(script);

      if(!address || !self._addressMap[address]) {
        continue;
      }

      var walletIds = self._addressMap[address];

      walletIds.forEach(function(walletId) {
        walletIdsNeedingUpdate[walletId] = true;

        operations.push({
          type: action,
          key: self._encoding.encodeWalletUtxoKey(walletId, tx.id, outputIndex),
          value: self._encoding.encodeWalletUtxoValue(block.__height, output.satoshis, output._scriptBuffer)
        });

        operations.push({
          type: action,
          key: self._encoding.encodeWalletUtxoSatoshisKey(walletId, output.satoshis, tx.id, outputIndex),
          value: self._encoding.encodeWalletUtxoValue(block.__height, output._scriptBuffer)
        });

        if(connectBlock) {
          self.balances[walletId] += output.satoshis;
        } else {
          self.balances[walletId] -= output.satoshis;
        }
      });
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

      var inputAddress = self.services.address.getAddressString(input.script);

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

WalletService.prototype.concurrentBlockHandler = function(block, connectBlock, callback) {
  var self = this;

  var txs = block.transactions;
  var height = block.__height;

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

      walletIds.forEach(function(walletId) {
        operations.push({
          type: action,
          key: self._encoding.encodeWalletTransactionKey(walletId, block.__height),
          value: self._encoding.encodeWalletTransactionValue(tx.id)
        })
      });
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

      var inputAddress = self._getAddressString(input.script);

      if(!inputAddress || !self._addressMap[inputAddress]) {
        continue;
      }

      var walletIds = self._addressMap[inputAddress];

      walletIds.forEach(function(walletId) {
        operations.push({
          type: action,
          key: self._encoding.encodeWalletTransactionKey(walletId, block.__height),
          value: self._encoding.encodeWalletTransactionValue(tx.id)
        });
      });
    }
  }
  setImmediate(function() {
    callback(null, operations);
  });
};

WalletService.prototype._loadAllAddresses = function(callback) {
  var self = this;

  self._addressMap = {};

  var start = self._encoding.encodeWalletKey('00');
  var end = self._encoding.encodeWalletKey(Array(65).join('f'));

  var stream = self.db.createReadStream({
    gte: start,
    lt: end
  });

  var streamErr = null;

  stream.on('data', function(data) {
    var key = self._encoding.decodeWalletAddressesKey(data.key);
    var value = self._encoding.decodeWalletAddressesValue(data.value);

    value.addresses.forEach(function(address) {
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
    var queryMempool = req.query.queryMempool === false ? false : true;
    //var tip = self.node.bitcoind.tip;
    // TODO: get the height of the tip
    //var height = tip;
    var height = null;

    var options = {
      queryMempool: queryMempool
    };
    self._getUtxos(walletId, height, options, function(err, utxos) {
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
    var queryMempool = req.query.queryMempool === false ? false : true;
    var byAddress = req.query.byAddress;

    //var tip = self.node.bitcoind.tip;
    // TODO: get the height of the tip
    //var height = tip;
    var height = null;

    var options = {
      queryMempool: queryMempool,
      byAddress: byAddress
    };

    self._getBalance(walletId, height, options, function(err, result) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(200).jsonp(result);
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

WalletService.prototype._endpointPostAddresses = function() {
  var self = this;
  return function(req, res) {
    var addresses = req.addresses;
    var walletId = utils.getWalletId();

    self._importAddresses(walletId, addresses, function(err) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(201).jsonp({
        walletId: walletId
      });
    });
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
    var newAddresses = req.body;

    if(!Array.isArray(req.body)) {
      return utils.sendError(new Error('Must PUT an array'), res);
    }

    var walletId = req.params.walletId;

    self._getAddresses(walletId, function(err, oldAddresses) {
      if(err) {
        return utils.sendError(err, res);
      }

      if(!oldAddresses) {
        return res.status(404).send('Not found');
      }

      var addAddresses = _.without(newAddresses, oldAddresses);
      var amountAdded = addAddresses.length;

      self._importAddresses(walletId, addAddresses, function(err) {
        if(err) {
          return utils.sendError(err, res);
        }

        res.status(200).jsonp({
          walletId: walletId,
          amountAdded: amountAdded
        });
      });
    });
  };
};

WalletService.prototype._getUtxos = function(walletId, callback) {
  var self = this;

  var stream = self.store.createReadStream({
    gte: self._encoding.encodeWalletUtxoKey(walletId),
    lt: self._encoding.encodeWalletUtxoKey(walletId, Array(33).join('f')) // come up with better terminal key
  });

  var utxos = [];
  var streamErr = null;

  stream.on('data', function(data) {
    var key = self._encoding.decodeWalletUtxoKey(data.key);
    var value = self._encoding.decodeWalletUtxoValue(data.value);

    utxos.push({
      txid: key.txid,
      outputIndex: key.outputIndex,
      height: value.height,
      satoshis: value.satoshis,
      script: value.script
    });
  });

  stream.on('error', function(err) {
    streamErr = err;
  });

  stream.on('end', function() {
    callback(streamErr, utxos);
  });
};

WalletService.prototype._getBalance = function(walletId, callback) {
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
  var transactions = [];
  var opts = {
    start: options.start,
    end: options.end
  };
  var key = walletId + opts.start + opts.end;
  if (!self._cache.peek(key)) {
    self._getAddresses(walletId, function(err, addresses) {
      if(err) {
        return callback(err);
      }
      if (!addresses) {
        return callback(new Error('wallet not found'));
      }
      var addressGroups = self._chunkAdresses(addresses);
      async.eachSeries(addressGroups, function(addresses, next) {
        self.node.services.bitcoind.getAddressHistory(addresses, opts, function(err, history) {
          if(err) {
            return next(err);
          }
          var groupTransactions = history.items.map(function(item) {
            return item.tx;
          });
          transactions = _.union(transactions, groupTransactions);
          next();
        });
      }, function(err) {
        if(err) {
          return callback(err);
        }
        self._cache.set(key, JSON.stringify(transactions));
        finish();
      });
    });
  } else {
    try {
      transactions = JSON.parse(self._cache.get(key));
      finish();
    } catch(e) {
      self._cache.del(key);
      return callback(e);
    }
  }
  function finish() {
    var from = options.from || 0;
    var to = options.to || transactions.length;
    callback(null, transactions.slice(from, to), transactions.length);
  }
};

WalletService.prototype._getAddresses = function(walletId, callback) {
  var key = this._encoding.encodeWalletAddressKey(walletId);
  this.store.get(key, callback);
};

WalletService.prototype._importAddresses = function(walletId, addresses, callback) {
  var self = this;

  self._getAddresses(walletId, function(err, oldAddresses) {
    if(err) {
      return callback(err);
    }

    async.parallel(
      [
        self._getUTXOIndexOperations.bind(self, walletId, addresses),
        self._getTxidOperations.bind(self, walletId, addresses)
      ],
      function(err, results) {
        if(err) {
          return callback(err);
        }

        var operations = results[0].concat(results[1]);
        operations.push({
          type: 'put',
          key: self._encoding.encodeWalletAddressKey(walletId),
          value: self._encoding.encodeWalletAddressValue(oldAddresses.concat(addresses))
        });

        self.store.batch(operations, function(err) {
          if(err) {
            return callback(err);
          }

          // TODO check if height has changed since we first entered the function
          // if it has, we need to get operations for the new blocks

          // Update addressMap and wallet balances
          self._loadAllAddresses(function(err) {
            if(err) {
              return callback(err);
            }

            self._loadAllBalances(callback);
          });
        });
      }
    );
  });
};

WalletService.prototype._getUTXOIndexOperations = function(walletId, addresses, callback) {
  var self = this;

  // TODO what if initialBalance changes while we are getting unspent outputs on new addresses?

  var balance = 0;

  self._getBalance(walletId, function(err, initialBalance) {
    if(err && !err.notFound) {
      return callback(err);
    }

    if(initialBalance) {
      balance = initialBalance;
    }

    self.services.address.getUnspentOutputs(addresses, function(err, utxos) {
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

WalletService.prototype._getTxidIndexOperations = function(walletId, addresses, callback) {
  var self = this;

  var txids = {};

  async.eachLimit(addresses, 10, function(address, next) {
    self.services.address.getAddressTxidsWithHeights(address, {}, function(err, tmpTxids) {
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

    operations = Object.keys(txids).map(function(txid) {
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
  var key = this._encoding.encodeWalletAddressKey(walletId);
  var value = this._encoding.encodeWalletValue(addresses);
  this.store.put(key, value, callback);
};

WalletService.prototype._storeBalance = function(walletId, balance, callback) {
  var key = this._encoding.encodeWalletBalanceKey(walletId);
  var value = this._encoding.encodeWalletBalanceValue(balance);
  this.store.put(key, value, callback);
};

WalletService.prototype._endpointGetInfo = function() {
  return function(req, res) {
    res.jsonp({result: 'ok'});
  };
};
WalletService.prototype.setupRoutes = function(app, express) {
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
  app.get('/wallets/:walletId',
    s._endpointGetAddresses()
  );
  app.put('/wallets/:walletId/addresses',
    s._endpointPutAddresses()
  );
  app.get('/wallets/:walletId/transactions',
    s._endpointGetTransactions()
  );
  app.post('/wallets',
    upload.single('addresses'),
    v.checkAddresses,
    s._endpointPostAddresses()
  );

};

WalletService.prototype.getRoutePrefix = function() {
  return 'wallet-api';
};

module.exports = WalletService;

