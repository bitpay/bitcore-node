'use strict';

var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var util = require('util');
var mkdirp = require('mkdirp');
var bitcore = require('bitcore-lib');
var Address = bitcore.Address;
var zmq = require('zmq');
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var $ = bitcore.util.preconditions;
var _  = bitcore.deps._;

var index = require('../');
var log = index.log;
var errors = index.errors;
var Service = require('../service');
var Transaction = require('../transaction');

/**
 * Provides an interface to native bindings to [Bitcoin Core](https://github.com/bitcoin/bitcoin)
 * compiled as a static library. The C++ bindings can be found at `src/libbitcoind.cc`
 * @param {Object} options
 * @param {Node} options.node - A reference to the node
 */
function Bitcoin(options) {
  if (!(this instanceof Bitcoin)) {
    return new Bitcoin(options);
  }

  this._reindex = false;
  this._reindexWait = 1000;
  Service.call(this, options);
  $.checkState(this.node.datadir, 'Node is missing datadir property');
}

util.inherits(Bitcoin, Service);

Bitcoin.dependencies = [];

Bitcoin.DEFAULT_CONFIG = 'whitelist=127.0.0.1\n' + 'txindex=1\n' + 'addressindex=1\n' + 'server=1\n';

/**
 * Called by Node to determine the available API methods.
 */
Bitcoin.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getBlockHeader', this, this.getBlockHeader, 1],
    ['getBlockHashesByTimestamp', this, this.getBlockHashesByTimestamp, 2],
    ['getTransaction', this, this.getTransaction, 2],
    ['getTransactionWithBlockInfo', this, this.getTransactionWithBlockInfo, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1],
    ['getAddressTxids', this, this.getAddressTxids, 2],
    ['getAddressBalance', this, this.getAddressBalance, 2],
    ['getAddressUnspentOutputs', this, this.getAddressUnspentOutputs, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
  return methods;
};

Bitcoin.prototype._loadConfiguration = function() {
  /* jshint maxstatements: 25 */

  $.checkArgument(this.node.datadir, 'Please specify "datadir" in configuration options');
  var configPath = this.node.datadir + '/bitcoin.conf';
  this.configuration = {};

  if (!fs.existsSync(this.node.datadir)) {
    mkdirp.sync(this.node.datadir);
  }

  var file = fs.readFileSync(configPath);
  var unparsed = file.toString().split('\n');
  for(var i = 0; i < unparsed.length; i++) {
    var line = unparsed[i];
    if (!line.match(/^\#/) && line.match(/\=/)) {
      var option = line.split('=');
      var value;
      if (!Number.isNaN(Number(option[1]))) {
        value = Number(option[1]);
      } else {
        value = option[1];
      }
      this.configuration[option[0]] = value;
    }
  }

  $.checkState(
    this.configuration.txindex && this.configuration.txindex === 1,
    '"txindex" option is required in order to use transaction query features of bitcore-node. ' +
      'Please add "txindex=1" to your configuration and reindex an existing database if ' +
      'necessary with reindex=1'
  );

  $.checkState(
    this.configuration.addressindex && this.configuration.addressindex === 1,
    '"addressindex" option is required in order to use address query features of bitcore-node. ' +
      'Please add "addressindex=1" to your configuration and reindex an existing database if ' +
      'necessary with reindex=1'
  );

  $.checkState(
    this.configuration.server && this.configuration.server === 1,
    '"server" option is required to communicate to bitcoind from bitcore. ' +
      'Please add "server=1" to your configuration and restart'
  );

  $.checkState(
    this.configuration.zmqpubhashtx,
    '"zmqpubhashtx" option is required to get event updates from bitcoind. ' +
      'Please add "zmqpubhashtx=tcp://127.0.0.1:<port>" to your configuration and restart'
  );

  $.checkState(
    this.configuration.zmqpubhashtx,
    '"zmqpubhashblock" option is required to get event updates from bitcoind. ' +
      'Please add "zmqpubhashblock=tcp://127.0.0.1:<port>" to your configuration and restart'
  );

  if (this.configuration.reindex && this.configuration.reindex === 1) {
    log.warn('Reindex option is currently enabled. This means that bitcoind is undergoing a reindex. ' +
      'The reindex flag will start the index from beginning every time the node is started, so it ' +
      'should be removed after the reindex has been initiated. Once the reindex is complete, the rest ' +
      'of bitcore-node services will start.');
    this._reindex = true;
  }

};

Bitcoin.prototype._registerEventHandlers = function() {
  var self = this;

  this.zmqSubSocket.subscribe('hashblock');
  this.zmqSubSocket.subscribe('hashtx');

  this.zmqSubSocket.on('message', function(topic, message) {
    var topicString = topic.toString('utf8');
    if (topicString === 'hashtx') {
      self.emit('tx', message.toString('hex'));
    } else if (topicString === 'hashblock') {
      self.tiphash = message.toString('hex');
      self.client.getBlock(self.tiphash, function(err, response) {
        if (err) {
          return log.error(err);
        }
        self.height = response.result.height;
        $.checkState(self.height >= 0);
        self.emit('tip', self.height);
      });

      if(!self.node.stopping) {
        self.syncPercentage(function(err, percentage) {
          if (err) {
            return log.error(err);
          }
          log.info('Bitcoin Height:', self.height, 'Percentage:', percentage.toFixed(2));
        });
      }
    }
  });

};

Bitcoin.prototype._onReady = function(result, callback) {
  var self = this;

  self._registerEventHandlers();

  self.client.getInfo(function(err, response) {
    if (err) {
      return callback(err);
    }
    self.height = response.result.blocks;

    self.client.getBlockHash(0, function(err, response) {
      if (err) {
        return callback(err);
      }
      var blockhash = response.result;
      self.getBlock(blockhash, function(err, block) {
        if (err) {
          return callback(err);
        }
        self.tiphash = block.hash;
        self.genesisBuffer = block.toBuffer();
        self.emit('ready', result);
        log.info('Bitcoin Daemon Ready');
        callback();
      });
    });
  });
};

Bitcoin.prototype._getNetworkOption = function() {
  var networkOption;
  if (this.node.network === bitcore.Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      networkOption = '--regtest';
    }
    networkOption = '--testnet';
  }
  return networkOption;
};

/**
 * Called by Node to start the service
 * @param {Function} callback
 */
Bitcoin.prototype.start = function(callback) {
  var self = this;

  self._loadConfiguration();

  var options = [
    '--conf=' + path.resolve(this.node.datadir, './bitcoin.conf'),
    '--datadir=' + this.node.datadir,
  ];

  if (self._getNetworkOption()) {
    options.push(self._getNetworkOption());
  }

  self.process = spawn('bitcoind', options, {stdio: 'inherit'});

  self.process.on('error', function(err) {
    log.error(err);
  });

  async.retry({times: 60, interval: 5000}, function(done) {
    if (self.node.stopping) {
      return done(new Error('Stopping while trying to connect to bitcoind.'));
    }

    self.client = new BitcoinRPC({
      protocol: 'http',
      host: '127.0.0.1',
      port: self.configuration.rpcport,
      user: self.configuration.rpcuser,
      pass: self.configuration.rpcpassword
    });

    self.client.getInfo(function(err) {
      if (err) {
        if (!(err instanceof Error)) {
          log.warn(err.message);
        }
        return done(new Error('Could not connect to bitcoind RPC'));
      }
      done();
    });

  }, function ready(err, result) {
    if (err) {
      return callback(err);
    }

    self.zmqSubSocket = zmq.socket('sub');

    self.zmqSubSocket.on('monitor_error', function(err) {
      log.error('Error in monitoring: %s, will restart monitoring in 5 seconds', err);
      setTimeout(function() {
        self.zmqSubSocket.monitor(500, 0);
      }, 5000);
    });

    self.zmqSubSocket.monitor(500, 0);
    self.zmqSubSocket.connect(self.configuration.zmqpubhashtx);

    if (self._reindex) {
      var interval = setInterval(function() {
        self.syncPercentage(function(err, percentSynced) {
          if (err) {
            return log.error(err);
          }
          log.info('Bitcoin Core Daemon Reindex Percentage: ' + percentSynced.toFixed(2));
          if (Math.round(percentSynced) >= 100) {
            self._reindex = false;
            self._onReady(result, callback);
            clearInterval(interval);
          }
        });
      }, self._reindexWait);

    } else {
      self._onReady(result, callback);
    }
  });

};

/**
 * Helper to determine the state of the database.
 * @param {Function} callback
 * @returns {Boolean} If the database is fully synced
 */
Bitcoin.prototype.isSynced = function(callback) {
  this.syncPercentage(function(err, percentage) {
    if (err) {
      return callback(err);
    }
    if (Math.round(percentage) >= 100) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  });
};

/**
 * Helper to determine the progress of the database.
 * @param {Function} callback
 * @returns {Number} An estimated percentage of the syncronization status
 */
Bitcoin.prototype.syncPercentage = function(callback) {
  this.client.getBlockchainInfo(function(err, response) {
    if (err) {
      return callback(err);
    }
    var percentSynced = response.result.verificationprogress * 100;
    callback(null, percentSynced);
  });
};

Bitcoin.prototype.getAddressBalance = function(addressArg, options, callback) {
  // TODO keep a cache and update the cache by a range of block heights
  var addresses = [addressArg];
  if (Array.isArray(addressArg)) {
    addresses = addressArg;
  }
  this.client.getAddressBalance({addresses: addresses}, function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });
};

Bitcoin.prototype.getAddressUnspentOutputs = function() {
  // TODO add this rpc method to bitcoind
};

Bitcoin.prototype.getAddressTxids = function(addressArg, options, callback) {
  // TODO Keep a cache updated for queries
  var addresses = [addressArg];
  if (Array.isArray(addressArg)) {
    addresses = addressArg;
  }
  this.client.getAddressTxids({addresses: addresses}, function(err, response) {
    if (err) {
      return callback(err);
    }
    return callback(null, response.result);
  });
};

Bitcoin.prototype._getConfirmationsDetail = function(transaction) {
  var confirmations = 0;
  if (transaction.__height >= 0) {
    confirmations = this.height - transaction.__height + 1;
  }
  return confirmations;
};

Bitcoin.prototype._getAddressDetailsForTransaction = function(transaction, addressStrings) {
  var result = {
    addresses: {},
    satoshis: 0
  };

  for (var inputIndex = 0; inputIndex < transaction.inputs.length; inputIndex++) {
    var input = transaction.inputs[inputIndex];
    if (!input.script) {
      continue;
    }
    var inputAddress = input.script.toAddress(this.node.network);
    if (inputAddress) {
      var inputAddressString = inputAddress.toString();
      if (addressStrings.indexOf(inputAddressString) >= 0) {
        if (!result.addresses[inputAddressString]) {
          result.addresses[inputAddressString] = {
            inputIndexes: [inputIndex],
            outputIndexes: []
          };
        } else {
          result.addresses[inputAddressString].inputIndexes.push(inputIndex);
        }
        result.satoshis -= input.output.satoshis;
      }
    }
  }

  for (var outputIndex = 0; outputIndex < transaction.outputs.length; outputIndex++) {
    var output = transaction.outputs[outputIndex];
    if (!output.script) {
      continue;
    }
    var outputAddress = output.script.toAddress(this.node.network);
    if (outputAddress) {
      var outputAddressString = outputAddress.toString();
      if (addressStrings.indexOf(outputAddressString) >= 0) {
        if (!result.addresses[outputAddressString]) {
          result.addresses[outputAddressString] = {
            inputIndexes: [],
            outputIndexes: [outputIndex]
          };
        } else {
          result.addresses[outputAddressString].outputIndexes.push(outputIndex);
        }
        result.satoshis += output.satoshis;
      }
    }
  }

  return result;

};

/**
 * Will expand into a detailed transaction from a txid
 * @param {Object} txid - A bitcoin transaction id
 * @param {Function} callback
 */
Bitcoin.prototype._getDetailedTransaction = function(txid, options, next) {
  var self = this;
  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;

  self.getTransactionWithBlockInfo(
    txid,
    queryMempool,
    function(err, transaction) {
      if (err) {
        return next(err);
      }

      transaction.populateInputs(self, [], function(err) {
        if (err) {
          return next(err);
        }

        var addressDetails = self._getAddressDetailsForTransaction(transaction, options.addressStrings);

        var details = {
          addresses: addressDetails.addresses,
          satoshis: addressDetails.satoshis,
          height: transaction.__height,
          confirmations: self._getConfirmationsDetail(transaction),
          timestamp: transaction.__timestamp,
          // TODO bitcore-lib should return null instead of throwing error on coinbase
          fees: !transaction.isCoinbase() ? transaction.getFee() : null,
          tx: transaction
        };
        next(null, details);
      });
    }
  );
};

Bitcoin.prototype._getAddressStrings = function(addresses) {
  var addressStrings = [];
  for (var i = 0; i < addresses.length; i++) {
    var address = addresses[i];
    if (address instanceof bitcore.Address) {
      addressStrings.push(address.toString());
    } else if (_.isString(address)) {
      addressStrings.push(address);
    } else {
      throw new TypeError('Addresses are expected to be strings');
    }
  }
  return addressStrings;
};

Bitcoin.prototype.getAddressHistory = function(addressArg, options, callback) {
  var self = this;
  var addresses = [addressArg];
  if (addresses.length > this.maxAddressesQuery) {
    return callback(new TypeError('Maximum number of addresses (' + this.maxAddressesQuery + ') exceeded'));
  }

  var queryMempool = _.isUndefined(options.queryMempool) ? true : options.queryMempool;
  var addressStrings = this._getAddressStrings(addresses);

  self.getAddressTxids(addresses, {}, function(err, txids) {
    if (err) {
      return callback(err);
    }
    async.mapSeries(
      txids,
      function(txid, next) {
        self._getDetailedTransaction(txid, {
          queryMempool: queryMempool,
          addressStrings: addressStrings
        }, next);
      },
      function(err, transactions) {
        if (err) {
          return callback(err);
        }
        callback(null, {
          totalCount: txids.length,
          items: transactions
        });
      }
    );
  });
};

Bitcoin.prototype.getAddressSummary = function(addressArg, options, callback) {
  // TODO: optional mempool
  var self = this;
  var summary = {};

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  function getBalance(done) {
    self.getAddressBalance(addressArg, options, function(err, data) {
      if (err) {
        return done(err);
      }
      summary.totalReceived = data.received;
      summary.totalSpent = data.received - data.balance;
      summary.balance = data.balance;
      done();
    });
  }

  function getTxList(done) {
    self.getAddressTxids(addressArg, options, function(err, txids) {
      if (err) {
        return done(err);
      }
      summary.txids = txids;
      summary.appearances = txids.length;
      done();
    });
  }

  var tasks = [];
  if (!options.noBalance) {
    tasks.push(getBalance);
  }
  if (!options.noTxList) {
    tasks.push(getTxList);
  }

  async.parallel(tasks, function(err) {
    if (err) {
      return callback(err);
    }
    callback(null, summary);
  });
};

/**
 * Will retrieve a block as a Node.js Buffer from disk.
 * @param {String|Number} block - A block hash or block height number
 */
Bitcoin.prototype.getBlock = function(block, callback) {
  // TODO apply performance patch to the RPC method for raw data
  // TODO keep a cache of results
  var self = this;

  function queryHeader(blockhash) {
    self.client.getBlock(blockhash, false, function(err, response) {
      if (err) {
        return callback(err);
      }
      var block = bitcore.Block.fromString(response.result);
      callback(null, block);
    });
  }

  if (_.isNumber(block)) {
    self.client.getBlockHash(block, function(err, response) {
      if (err) {
        return callback(err);
      }
      var blockhash = response.result;
      queryHeader(blockhash);
    });
  } else {
    queryHeader(block);
  }

};

Bitcoin.prototype.getBlockHashesByTimestamp = function(high, low, callback) {
  var self = this;
  self.client.getBlockHashes(high, low, function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });
};

/**
 * Will return the block index information, the output will have the format:
 * {
 *   prevHash: '000000004956cc2edd1a8caa05eacfa3c69f4c490bfc9ace820257834115ab35',
 *   nextHash: '0000000000629d100db387f37d0f37c51118f250fb0946310a8c37316cbc4028'
 *   hash: ' 00000000009e2958c15ff9290d571bf9459e93b19765c6801ddeccadbb160a1e',
 *   chainWork: '0000000000000000000000000000000000000000000000000000000000000016',
 *   height: 10
 * }
 * @param {String|Number} block - A block hash or block height
 * @returns {Object}
 */
Bitcoin.prototype.getBlockHeader = function(block, callback) {
  // TODO keep a cache of queries
  var self = this;

  function queryHeader(blockhash) {
    self.client.getBlockHeader(blockhash, function(err, response) {
      if (err) {
        return callback(err);
      }
      callback(null, response.result);
    });
  }

  if (_.isNumber(block)) {
    self.client.getBlockHash(block, function(err, response) {
      if (err) {
        return callback(err);
      }
      var blockhash = response.result;
      queryHeader(blockhash);
    });
  } else {
    queryHeader(block);
  }
};

/**
 * Will estimate the fee per kilobyte.
 * @param {Number} blocks - The number of blocks for the transaction to be confirmed.
 * @returns {Number}
 */
Bitcoin.prototype.estimateFee = function(blocks, callback) {
  this.client.estimateFee(blocks, function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });
};

/**
 * Will add a transaction to the mempool and relay to connected peers, the function
 * will throw an error if there were validation problems.
 * @param {String} transaction - The hex string of the transaction
 * @param {Boolean} allowAbsurdFees - Enable large fees
 */
Bitcoin.prototype.sendTransaction = function(tx, allowAbsurdFees, callback) {
  var txString;
  if (tx instanceof Transaction) {
    txString = tx.serialize();
  } else {
    txString = tx;
  }

  this.client.sendTransaction(txString, allowAbsurdFees, function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });

};

/**
 * Will get a transaction as a Node.js Buffer from disk and the mempool.
 * @param {String} txid - The transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Bitcoin.prototype.getTransaction = function(txid, queryMempool, callback) {
  // TODO keep an LRU cache available of transactions
  this.client.getRawTransaction(txid, function(err, response) {
    if (err) {
      return callback(err);
    }
    if (!response.result) {
      return callback(new errors.Transaction.NotFound());
    }
    var tx = Transaction();
    tx.fromString(response.result);
    callback(null, tx);
  });
};

/**
 * Will get a transaction with additional information about the block, in the format:
 * {
 *   blockHash: '2725743288feae6bdaa976590af7cb12d7b535b5a242787de6d2789c73682ed1',
 *   height: 48,
 *   timestamp: 1442951110, // in seconds
 *   buffer: <Buffer...> // transaction buffer
 * }
 * @param {String} txid - The transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Bitcoin.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  // TODO keep an LRU cache available of transactions
  // TODO get information from txindex as an RPC method
  this.client.getRawTransaction(txid, 1, function(err, response) {
    if (err) {
      return callback(err);
    }
    if (!response.result) {
      return callback(new errors.Transaction.NotFound());
    }
    var tx = Transaction();
    tx.fromString(response.result.hex);
    tx.__blockHash = response.result.blockhash;
    tx.__height = response.result.height;
    tx.__timestamp = response.result.time;
    callback(null, tx);
  });
};

/**
 * Will get the best block hash for the chain.
 * @returns {String}
 */
Bitcoin.prototype.getBestBlockHash = function(callback) {
  // TODO keep an LRU cache available of transactions
  this.client.getBestBlockHash(function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });
};

Bitcoin.prototype.getInputForOutput = function(txid, index, options, callback) {
  // TODO
  setImmediate(callback);
};

/**
 * This will return information about the database in the format:
 * {
 *   version: 110000,
 *   protocolversion: 70002,
 *   blocks: 151,
 *   timeoffset: 0,
 *   connections: 0,
 *   difficulty: 4.6565423739069247e-10,
 *   testnet: false,
 *   relayfee: 1000,
 *   errors: ''
 * }
 */
Bitcoin.prototype.getInfo = function(callback) {
  this.client.getInfo(function(err, response) {
    if (err) {
      return callback(err);
    }
    callback(null, response.result);
  });
};

/**
 * Called by Node to stop the service.
 * @param {Function} callback
 */
Bitcoin.prototype.stop = function(callback) {
  if (this.process) {
    this.process.once('exit', function(err, status) {
      if (err) {
        return callback(err);
      } else {
        return callback();
      }
    });
    this.process.kill('SIGHUP');
  } else {
    callback();
  }
};

module.exports = Bitcoin;
