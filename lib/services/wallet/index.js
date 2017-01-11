'use strict';

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
/**
 * The Address Service builds upon the Database Service and the Bitcoin Service to add additional
 * functionality for getting information by base58check encoded addresses. This includes getting the
 * balance for an address, the history for a collection of addresses, and unspent outputs for
 * constructing transactions. This is typically the core functionality for building a wallet.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 */
var WalletService = function(options) {
  BaseService.call(this, options);
  this._dbOptions = {
    keyEncoding: 'string',
    valueEncoding: 'json'
  };
  this._db = levelup(options.dbPath, this._dbOptions);
};

inherits(WalletService, BaseService);

WalletService.dependencies = [
  'bitcoind',
  'web'
];

/**
 * Called by the Node to get the available API methods for this service,
 * that can be exposed over the JSON-RPC interface.
 */
WalletService.prototype.getAPIMethods = function() {
  return [
    //['getWalletInfo', this, this.getInfo, 0]
    //['getWalletBalance', this, this.getWalletBalance, 2],
    //['getBlockTimestampInfo', this, this.getBlockTimestampInfo, 2],
    //['addWalletAddresses', this, this., 2],
    //['addWalletAddress', this, this.addWalletAddress, 2],
    //['addWallet', this, this.addWallet, 2],
    //['getWalletUtxos', this, this.getWalletUtxos, 2],
    //['getWalletRawTransactions', this, this.getWalletRawTransactions, 1]
    //['getWalletTxids', this, this.getWalletTxids, 1]
    //['getWalletTransactions', this, this.getWalletTransactions, 1]
  ];
};
WalletService.prototype.start = function(callback) {
  setImmediate(callback);
};

WalletService.prototype.stop = function(callback) {
  setImmediate(callback);
};

/**
 * Called by the Bus to get the available events for this service.
 */
WalletService.prototype.getPublishEvents = function() {
  return [];
};

WalletService.prototype._endpointUTXOs = function() {
  var self = this;
  return function(req, res) {
    var walletId = req.params.walletId;
    //var tip = self.node.bitcoind.tip;
    // TODO: get the height of the tip
    //var height = tip;
    var height = null;
    self._getUtxos(walletId, height,  function(err, utxos) {
      if(err) {
        return utils.sendError(err);
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
    var walletId = req.params.walletId;
    //var tip = self.node.bitcoind.tip;
    // TODO: get the height of the tip
    //var height = tip;
    var height = null;
    self._getBalance(walletId, height,  function(err, balance) {
      if(err) {
        return utils.sendError(err);
      }
      res.status(200).jsonp({
        balance: balance,
        height: height
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
        return utils.sendError(err);
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
    self._storeAddresses(walletId, addresses, function(err, hash) {
      if(err) {
        return utils.sendError(err, res);
      }
      res.status(201).jsonp({
        walletId: walletId,
      });
    });
  };
};

WalletService.prototype._getUtxos = function(walletId, height, callback) {
  // TODO get the balance only to this height
  var self = this;
  self._getAddresses(walletId, function(err, addresses) {
    if(err) {
      return callback(err);
    }

    self.node.services.bitcoind.getAddressUnspentOutputs(addresses, {queryMempool: false}, callback);
  });
};
WalletService.prototype._getBalance = function(walletId, height, callback) {
  // TODO get the balance only to this height
  var self = this;
  self._getAddresses(walletId, function(err, addresses) {
    if(err) {
      return callback(err);
    }
    self.node.services.bitcoind.getAddressUnspentOutputs(addresses, {
      queryMempool: false
    }, function(err, utxos) {
      if(err) {
        return callback(err);
      }
      var balance = 0;
      utxos.forEach(function(utxo) {
        balance += utxo.satoshis;
      });
      callback(null, balance);
    });
  });
};
WalletService.prototype._getAddresses = function(walletId, callback) {
  this._db.get(walletId, callback);
};
WalletService.prototype._storeAddresses = function(walletId, addresses, callback) {
  this._db.put(walletId, addresses, callback);
};

WalletService.prototype._endpointGetInfo = function() {
  return function(req, res) {
    res.jsonp({result: 'ok'});
  };
};
WalletService.prototype.setupRoutes = function(app, express) {
  var s = this;
  var v = validators;
  app.get('/info',
    s._endpointGetInfo()
  );
  //app.get('/wallets/:walletId/txids',
  //  v.checkWalletId,
  //  v.checkRangeParams,
  //  s._endpointTxids()
  //);
  //app.get('/wallets/:walletId/transactions',
  //  v.checkWalletId,
  //  v.checkRangeParams,
  //  s._endpointTransactions()
  //);
  //app.get('/wallets/:walletId/rawtransactions',
  //  v.checkWalletId,
  //  v.checkRangeParams,
  //  s._endpointRawTransactions()
  //);
  app.get('/wallets/:walletId/utxos',
    s._endpointUTXOs()
  );
  app.get('/wallets/:walletId/balance',
    s._endpointGetBalance()
  );
  app.get('/wallets/:walletId',
    s._endpointGetAddresses()
  );
  app.post('/wallets/addresses',
    upload.single('addresses'),
    v.checkAddresses,
    s._endpointPostAddresses()
  );
  //app.put('/wallets/:walletId',
  //  v.checkWalletId,
  //  s._endpointPutWallet()
  //);
  //app.get('/info/timestamps',
  //  s._endpointGetHeightsFromTimestamps()
  //);
  //app.get('/jobs/:jobId',
  //  s._endpointJobStatus()
  //);
  //app.use(s._endpointNotFound());
};

WalletService.prototype.getRoutePrefix = function() {
  return 'wallet';
};
module.exports = WalletService;

