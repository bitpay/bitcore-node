'use strict';

var fs = require('fs');
var BaseService = require('../../service');
var inherits = require('util').inherits;
var async = require('async');
var mkdirp = require('mkdirp');
var index = require('../../');
var log = index.log;
var errors = index.errors;
var bitcore = require('bitcore-lib');
var Networks = bitcore.Networks;
var levelup = require('levelup');
var leveldown = require('leveldown');
var memdown = require('memdown');
var $ = bitcore.util.preconditions;
var _ = bitcore.deps._;
var Hash = bitcore.crypto.Hash;
var EventEmitter = require('events').EventEmitter;
var Address = bitcore.Address;
var AddressHistory = require('./history');
var constants = require('./constants');
var encoding = require('./encoding');

/**
 * The Address Service builds upon the Database Service and the Bitcoin Service to add additional
 * functionality for getting information by base58check encoded addresses. This includes getting the
 * balance for an address, the history for a collection of addresses, and unspent outputs for
 * constructing transactions. This is typically the core functionality for building a wallet.
 * @param {Object} options
 * @param {Node} options.node - An instance of the node
 * @param {String} options.name - An optional name of the service
 */
var AddressService = function(options) {
  BaseService.call(this, options);

  this.subscriptions = {};
  this.subscriptions['address/transaction'] = {};
  this.subscriptions['address/balance'] = {};

  this._bitcoindTransactionListener = this.transactionHandler.bind(this);
  this._bitcoindTransactionLeaveListener = this.transactionLeaveHandler.bind(this);
  this.node.services.bitcoind.on('tx', this._bitcoindTransactionListener);
  this.node.services.bitcoind.on('txleave', this._bitcoindTransactionLeaveListener);

  this.maxInputsQueryLength = options.maxInputsQueryLength || constants.MAX_INPUTS_QUERY_LENGTH;
  this.maxOutputsQueryLength = options.maxOutputsQueryLength || constants.MAX_OUTPUTS_QUERY_LENGTH;

  this._setMempoolIndexPath();
  if (options.mempoolMemoryIndex) {
    this.levelupStore = memdown;
  } else {
    this.levelupStore = leveldown;
  }
  this.mempoolIndex = null; // Used for larger mempool indexes
  this.mempoolSpentIndex = {}; // Used for small quick synchronous lookups
  this.mempoolAddressIndex = {}; // Used to check if an address is on the spend pool
};

inherits(AddressService, BaseService);

AddressService.dependencies = [
  'bitcoind',
  'db'
];

AddressService.prototype.start = function(callback) {
  var self = this;

  async.series([

    function(next) {
      // Flush any existing mempool index
      if (fs.existsSync(self.mempoolIndexPath)) {
        leveldown.destroy(self.mempoolIndexPath, next);
      } else {
        setImmediate(next);
      }
    },
    function(next) {
      // Setup new mempool index
      if (!fs.existsSync(self.mempoolIndexPath)) {
        mkdirp(self.mempoolIndexPath, next);
      } else {
        setImmediate(next);
      }
    },
    function(next) {
      self.mempoolIndex = levelup(
        self.mempoolIndexPath,
        {
          db: self.levelupStore,
          keyEncoding: 'binary',
          valueEncoding: 'binary',
          fillCache: false,
          maxOpenFiles: 200
        },
        next
      );
    }
  ], callback);

};

AddressService.prototype.stop = function(callback) {
  // TODO Keep track of ongoing db requests before shutting down
  this.node.services.bitcoind.removeListener('tx', this._bitcoindTransactionListener);
  this.node.services.bitcoind.removeListener('txleave', this._bitcoindTransactionLeaveListener);
  this.mempoolIndex.close(callback);
};

/**
 * This function will set `this.mempoolIndexPath` based on `this.node.network`.
 * @private
 */
AddressService.prototype._setMempoolIndexPath = function() {
  this.mempoolIndexPath = this._getDBPathFor('bitcore-addressmempool.db');
};

AddressService.prototype._getDBPathFor = function(dbname) {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  var path;
  if (this.node.network === Networks.livenet) {
    path = this.node.datadir + '/' + dbname;
  } else if (this.node.network === Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      path = this.node.datadir + '/regtest/' + dbname;
    } else {
      path = this.node.datadir + '/testnet3/' + dbname;
    }
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
  return path;
};

/**
 * Called by the Node to get the available API methods for this service,
 * that can be exposed over the JSON-RPC interface.
 */
AddressService.prototype.getAPIMethods = function() {
  return [
    ['getBalance', this, this.getBalance, 2],
    ['getAddressSummary', this, this.getAddressSummary, 2],
    ['getTransactionIds', this, this.getTransactionIds, 2],
    ['getTransactionCount', this, this.getTransactionCount, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['getInputForOutput', this, this.getInputForOutput, 2]
  ];
};

/**
 * Called by the Bus to get the available events for this service.
 */
AddressService.prototype.getPublishEvents = function() {
  return [
    {
      name: 'address/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'address/transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'address/transaction')
    },
    {
      name: 'address/balance',
      scope: this,
      subscribe: this.subscribe.bind(this, 'address/balance'),
      unsubscribe: this.unsubscribe.bind(this, 'address/balance')
    }
  ];
};

/**
 * Will process each output of a transaction from the daemon "tx" event, and construct
 * an object with the data for the message to be relayed to any subscribers for an address.
 *
 * @param {Object} messages - An object to collect messages
 * @param {Transaction} tx - Instance of the transaction
 * @param {Number} outputIndex - The index of the output in the transaction
 * @param {Boolean} rejected - If the transaction was rejected by the mempool
 */
AddressService.prototype.transactionOutputHandler = function(messages, tx, outputIndex, rejected) {
  var script = tx.outputs[outputIndex].script;

  // If the script is invalid skip
  if (!script) {
    return;
  }

  var addressInfo = encoding.extractAddressInfoFromScript(script, this.node.network);
  if (!addressInfo) {
    return;
  }

  addressInfo.hashHex = addressInfo.hashBuffer.toString('hex');

  // Collect data to publish to address subscribers
  if (messages[addressInfo.hashHex]) {
    messages[addressInfo.hashHex].outputIndexes.push(outputIndex);
  } else {
    messages[addressInfo.hashHex] = {
      tx: tx,
      outputIndexes: [outputIndex],
      addressInfo: addressInfo,
      rejected: rejected
    };
  }
};

/**
 * This will handle data from the daemon "txleave" that a transaction has left the mempool.
 * @param {Object} txInfo - The data from the daemon.on('txleave') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {String} txInfo.hash - The hash of the transaction
 */
AddressService.prototype.transactionLeaveHandler = function(txInfo) {
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);
  this.updateMempoolIndex(tx, false);
};

/**
 * This will handle data from the daemon "tx" event, go through each of the outputs
 * and send messages by calling `transactionEventHandler` to any subscribers for a
 * particular address.
 * @param {Object} txInfo - The data from the daemon.on('tx') event
 * @param {Buffer} txInfo.buffer - The transaction buffer
 * @param {Boolean} txInfo.mempool - If the transaction was accepted in the mempool
 * @param {String} txInfo.hash - The hash of the transaction
 * @param {Function} [callback] - Optional callback
 */
AddressService.prototype.transactionHandler = function(txInfo, callback) {
  var self = this;

  if (!callback) {
    callback = function(err) {
      if (err) {
        return log.error(err);
      }
    };
  }

  if (this.node.stopping) {
    return callback();
  }

  // Basic transaction format is handled by the daemon
  // and we can safely assume the buffer is properly formatted.
  var tx = bitcore.Transaction().fromBuffer(txInfo.buffer);

  var messages = {};

  var outputsLength = tx.outputs.length;
  for (var i = 0; i < outputsLength; i++) {
    this.transactionOutputHandler(messages, tx, i, !txInfo.mempool);
  }

  function finish(err) {
    if (err) {
      return callback(err);
    }
    for (var key in messages) {
      self.transactionEventHandler(messages[key]);
      self.balanceEventHandler(null, messages[key].addressInfo);
    }
    callback();
  }

  if (txInfo.mempool) {
    self.updateMempoolIndex(tx, true, finish);
  } else {
    setImmediate(finish);
  }

};

AddressService.prototype._updateAddressIndex = function(key, add) {
  var currentValue = this.mempoolAddressIndex[key] || 0;

  if(add) {
    if (currentValue > 0) {
      this.mempoolAddressIndex[key] = currentValue + 1;
    } else  {
      this.mempoolAddressIndex[key] = 1;
    }
  } else {
    if (currentValue <= 1) {
      delete this.mempoolAddressIndex[key];
    } else {
      this.mempoolAddressIndex[key]--;
    }
  }
};


/**
 * This function will update the mempool address index with the necessary
 * information for further lookups.
 * @param {Transaction} - An instance of a Bitcore Transaction
 * @param {Boolean} - Add/remove from the index
 */
AddressService.prototype.updateMempoolIndex = function(tx, add, callback) {
  /* jshint maxstatements: 100 */

  var operations = [];
  var timestampBuffer = new Buffer(new Array(8));
  timestampBuffer.writeDoubleBE(new Date().getTime());

  var action = 'put';
  if (!add) {
    action = 'del';
  }

  var txid = tx.hash;
  var txidBuffer = new Buffer(txid, 'hex');

  var outputLength = tx.outputs.length;
  for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
    var output = tx.outputs[outputIndex];
    if (!output.script) {
      continue;
    }
    var addressInfo = encoding.extractAddressInfoFromScript(output.script, this.node.network);
    if (!addressInfo) {
      continue;
    }

    var addressIndexKey = encoding.encodeMempoolAddressIndexKey(addressInfo.hashBuffer, addressInfo.hashTypeBuffer);

    this._updateAddressIndex(addressIndexKey, add);

    // Update output index
    var outputIndexBuffer = new Buffer(4);
    outputIndexBuffer.writeUInt32BE(outputIndex);

    var outKey = Buffer.concat([
      constants.MEMPREFIXES.OUTPUTS,
      addressInfo.hashBuffer,
      addressInfo.hashTypeBuffer,
      txidBuffer,
      outputIndexBuffer
    ]);

    var outValue = encoding.encodeOutputMempoolValue(
      output.satoshis,
      timestampBuffer,
      output._scriptBuffer
    );

    operations.push({
      type: action,
      key: outKey,
      value: outValue
    });

  }
  var inputLength = tx.inputs.length;
  for (var inputIndex = 0; inputIndex < inputLength; inputIndex++) {

    var input = tx.inputs[inputIndex];

    var inputOutputIndexBuffer = new Buffer(4);
    inputOutputIndexBuffer.writeUInt32BE(input.outputIndex);

    // Add an additional small spent index for fast synchronous lookups
    var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(
      input.prevTxId,
      input.outputIndex
    );
    if (add) {
      this.mempoolSpentIndex[spentIndexSyncKey] = true;
    } else {
      delete this.mempoolSpentIndex[spentIndexSyncKey];
    }

    // Add a more detailed spent index with values
    var spentIndexKey = Buffer.concat([
      constants.MEMPREFIXES.SPENTSMAP,
      input.prevTxId,
      inputOutputIndexBuffer
    ]);
    var inputIndexBuffer = new Buffer(4);
    inputIndexBuffer.writeUInt32BE(inputIndex);
    var inputIndexValue = Buffer.concat([
      txidBuffer,
      inputIndexBuffer
    ]);
    operations.push({
      type: action,
      key: spentIndexKey,
      value: inputIndexValue
    });

    // Update input index
    var inputHashBuffer;
    var inputHashType;
    if (input.script.isPublicKeyHashIn()) {
      inputHashBuffer = Hash.sha256ripemd160(input.script.chunks[1].buf);
      inputHashType = constants.HASH_TYPES.PUBKEY;
    } else if (input.script.isScriptHashIn()) {
      inputHashBuffer = Hash.sha256ripemd160(input.script.chunks[input.script.chunks.length - 1].buf);
      inputHashType = constants.HASH_TYPES.REDEEMSCRIPT;
    } else {
      continue;
    }
    var inputKey = Buffer.concat([
      constants.MEMPREFIXES.SPENTS,
      inputHashBuffer,
      inputHashType,
      input.prevTxId,
      inputOutputIndexBuffer
    ]);
    var inputValue = Buffer.concat([
      txidBuffer,
      inputIndexBuffer,
      timestampBuffer
    ]);
    operations.push({
      type: action,
      key: inputKey,
      value: inputValue
    });

    var addressIndexKey = encoding.encodeMempoolAddressIndexKey(inputHashBuffer, inputHashType);

    this._updateAddressIndex(addressIndexKey, add);
  }

  if (!callback) {
    callback = function(err) {
      if (err) {
        return log.error(err);
      }
    };
  }

  this.mempoolIndex.batch(operations, callback);
};

/**
 * The Database Service will run this function when blocks are connected and
 * disconnected to the chain during syncing and reorganizations.
 *
 * The database holds the following indexes:
 *
 * Prefix         Key                              Value
 * ------------   -----------------------------    --------------------------
 * BLOCK          timestamp(height?)               blockHash:transactionCount:bytes
 *
 * SUMMARY        addressHash:type                 balance:received:change:transactionCount
 *
 * TXIDS          addressHash:type:height:txid     null
 *
 * PREV           txid:outputIndex                 addressHash:type:satoshis|txid:inputIndex:height
 *
 * UNSPENT        addressHash:type:height:         null
 *                txid:outputIndex
 *
 * @param {Block} block - An instance of a Bitcore Block
 * @param {Boolean} add - If the block is being removed or added to the chain
 * @param {Function} callback
 */
AddressService.prototype.blockHandler = function(block, add, callback) {
  // TODO: refactor into smaller functions

  var self = this;
  var txs = block.transactions;
  var height = block.__height;
  var heightBuffer = new Buffer(new Array(4));
  heightBuffer.writeUInt32BE(height);
  var operations = [];

  // Keep track of the number of transactions per address
  var addressTxCountDelta = {};

  // Previous outputs for this block
  var prevOutputs = {};

  // Changes to address balance within this block
  var summaryDeltas = {};

  async.eachSeries(txs, function(tx, nextTransaction) {
    var txid = tx.id;
    var txidBuffer = new Buffer(txid, 'hex');

    // Subscription messages
    var txmessages = {};

    var addressesInTransaction = {};
    var inputSatoshis = {};

    async.series([
      function(inputsDone) {
        if (tx.isCoinbase()) {
          return inputsDone();
        }
        async.forEachOf(tx.inputs, function(input, inputIndex, nextInput) {

          var prevOutputKeyBuffer = encoding.encodePrevOutputKey(input.prevTxId, input.outputIndex);
          var prevOutputKeyString = prevOutputKeyBuffer.toString('hex');
          // First check if we have this value locally stored within this block
          if (prevOutputs[prevOutputKeyString]) {
            finish(prevOutputs[prevOutputKeyString]);
          } else {
            // Otherwise check in previous blocks
            self.node.services.db.store.get(prevOutputKeyBuffer, {
              valueEncoding: 'binary',
            }, function(err, prevOutputValue) {
              if (err instanceof levelup.errors.NotFoundError) {
                return nextInput();
              } else if (err) {
                return nextInput(err);
              } else {
                finish(prevOutputValue);
              }
            });
          }

          function finish(prevOutputValue) {
            var hashBuffer = prevOutputValue.slice(0, 20);
            var hashTypeBuffer = prevOutputValue.slice(20, 21);
            var prevOutputSatoshis = prevOutputValue.readDoubleBE(21);

            // Keep track of changes to index for address -> balance
            var key = Buffer.concat([hashBuffer, hashTypeBuffer]).toString('hex');
            var balanceDiff = add ? prevOutputSatoshis * -1 : prevOutputSatoshis;

            // Keep track of incoming satoshis for address within this transaction
            // for the purposes of calculating the change received
            inputSatoshis[key] = prevOutputSatoshis;

            if (summaryDeltas[key]) {
              summaryDeltas[key].balance += balanceDiff;
            } else {
              summaryDeltas[key] = {
                balance: balanceDiff,
                received: 0,
                change: 0
              };
            }

            // Create batch operation to add/remove unspent key for address -> unspent outputs
            var addressKeyBuffer = encoding.encodeUnspentKey(
              hashBuffer,
              hashTypeBuffer,
              height,
              txidBuffer,
              input.outputIndex
            );
            operations.push({
              type: add ? 'del' : 'put',
              key: addressKeyBuffer,
              value: true
            });

            // Mark prevOutputValue as spent with txid and inputIndex
            if (add) {
              var inputIndexBuffer = new Buffer(new Array(4));
              inputIndexBuffer.writeUInt32BE(inputIndex);
              var spentBuffer = Buffer.concat([txidBuffer, inputIndexBuffer]);
              // Append spent txid and inputIndex
              prevOutputs[prevOutputKeyString] = Buffer.concat([prevOutputValue, spentBuffer]);
            } else {
              // Remove spent txid and inputIndex
              prevOutputs[prevOutputKeyString] = prevOutputValue.slice(0, 29);
            }

            // Append this txid to address -> txids index
            var addressTxIdKey = Buffer.concat([hashBuffer, hashTypeBuffer]);
            addressesInTransaction[addressTxIdKey.toString('hex')] = true;

            nextInput();
          }

        }, inputsDone);
      },
      function(outputsDone) {
        async.forEachOf(tx.outputs, function(output, outputIndex, nextOutput) {
          // Attempt to recognize the script as standard p2pkh or p2sh
          var script = output.script;
          if (!script) {
            return nextOutput();
          }
          var addressInfo = encoding.extractAddressInfoFromScript(script, self.node.network);
          if (!addressInfo) {
            return nextOutput();
          }

          // Create batch operation to add/remove unspent key for address -> unspent outputs
          var addressKeyBuffer = encoding.encodeUnspentKey(
            addressInfo.hashBuffer,
            addressInfo.hashTypeBuffer,
            height,
            txidBuffer,
            outputIndex
          );
          operations.push({
            type: add ? 'put' : 'del',
            key: addressKeyBuffer,
            value: true
          });

          // Keep track of txid:outputIndex -> satoshis:address:(spent) for this block
          var prevOutputKeyBuffer = encoding.encodePrevOutputKey(txidBuffer, outputIndex);
          var prevOutputKeyString = prevOutputKeyBuffer.toString('hex');
          var prevOutputValue = encoding.encodePrevOutputValue(
            addressInfo.hashBuffer,
            addressInfo.hashTypeBuffer,
            output.satoshis
          );
          if (add) {
            prevOutputs[prevOutputKeyString] = prevOutputValue;
          } else {
            prevOutputs[prevOutputKeyString] = null;
          }

          // Keep track of changes to address -> balance for this block
          var outKey = Buffer.concat([addressInfo.hashBuffer, addressInfo.hashTypeBuffer]).toString('hex');
          var outBalanceDiff = add ? output.satoshis : output.satoshis * -1;

          // Keep track of the amount that this output is coming from an input
          // with the same address
          var change = 0;
          if (inputSatoshis[outKey]) {
            change = Math.min(inputSatoshis[outKey], output.satoshis);
            inputSatoshis -= change;
          }

          if (summaryDeltas[outKey]) {
            summaryDeltas[outKey].balance += outBalanceDiff;
            summaryDeltas[outKey].received += outBalanceDiff;
            summaryDeltas[outKey].change += add ? change : change * -1;
          } else {
            summaryDeltas[outKey] = {
              balance: outBalanceDiff,
              received: outBalanceDiff,
              change: change
            };
          }

          // Append this txid to address -> txids index
          var addressTxIdKey = Buffer.concat([addressInfo.hashBuffer, addressInfo.hashTypeBuffer]);
          addressesInTransaction[addressTxIdKey.toString('hex')] = true;

          // Collect data for subscribers
          addressInfo.hashHex = addressInfo.hashBuffer.toString('hex');
          if (txmessages[addressInfo.hashHex]) {
            txmessages[addressInfo.hashHex].outputIndexes.push(outputIndex);
          } else {
            txmessages[addressInfo.hashHex] = {
              tx: tx,
              height: height,
              outputIndexes: [outputIndex],
              addressInfo: addressInfo,
              timestamp: block.header.timestamp
            };
          }

          self.balanceEventHandler(block, addressInfo);

          nextOutput();

        }, outputsDone);
      }
    ], function(err) {
      if (err) {
        return nextTransaction(err);
      }

      // Create batch operations for address -> txids values for this transaction
      for (var addressTxIdKey in addressesInTransaction) {
        if (addressTxCountDelta[addressTxIdKey]) {
          addressTxCountDelta[addressTxIdKey] += add ? 1 : -1;
        } else {
          addressTxCountDelta[addressTxIdKey] = add ? 1 : -1;
        }
        var addressTxIdKeyBuffer = new Buffer(addressTxIdKey, 'hex');
        var heightAndTxId = Buffer.concat([heightBuffer, txidBuffer]);
        operations.push({
          type: add ? 'put' : 'del',
          key: Buffer.concat([constants.PREFIXES.TXIDS, addressTxIdKeyBuffer, constants.SPACER_MIN, heightAndTxId]),
          value: true
        });
      }

      // Publish events to any subscribers for this transaction
      for (var addressKey in txmessages) {
        self.transactionEventHandler(txmessages[addressKey]);
      }

      nextTransaction();
    });

  }, function(err) {
    if (err) {
      return callback(err);
    }

    // Create batch operations to update the summary for each address for this block
    async.forEachOf(summaryDeltas, function(delta, addressKey, nextDelta) {
      var addressKeyBuffer = Buffer.concat([constants.PREFIXES.SUMMARY, new Buffer(addressKey, 'hex')]);
      self.node.services.db.store.get(addressKeyBuffer, {
        valueEncoding: 'binary'
      }, function(err, addressSummaryValue) {
        var addressSummary = new Buffer(new Array(28));
        if (err instanceof levelup.errors.NotFoundError) {
          addressSummary.writeDoubleBE(delta.balance);
          addressSummary.writeDoubleBE(delta.received, 8);
          addressSummary.writeDoubleBE(delta.change, 16);
          addressSummary.writeUInt32BE(addressTxCountDelta[addressKey], 24);
        } else if (err) {
          return nextDelta(err);
        } else {
          var balance = addressSummaryValue.readDoubleBE() + delta.balance;
          addressSummary.writeDoubleBE(balance);
          var received = addressSummaryValue.readDoubleBE(8) + delta.received;
          addressSummary.writeDoubleBE(received, 8);
          var change = addressSummaryValue.readDoubleBE(16) + delta.change;
          addressSummary.writeDoubleBE(change, 16);
          var txCount = addressSummaryValue.readUInt32BE(24) + addressTxCountDelta[addressKey];
          addressSummary.writeUInt32BE(txCount, 24);
        }
        operations.push({
          type: 'put',
          key: addressKeyBuffer,
          value: addressSummary
        });
        nextDelta();
      });
    }, function(err) {
      if (err) {
        return callback(err);
      }

      // Create batch operations to update the previous outputs for this block
      for (var prevOutputKey in prevOutputs) {
        if (prevOutputs[prevOutputKey]) {
          operations.push({
            type: 'put',
            key: new Buffer(prevOutputKey, 'hex'),
            value: prevOutputs[prevOutputKey]
          });
        } else {
          // prevOutputs that are set to null should be removed
          operations.push({
            type: 'del',
            key: new Buffer(prevOutputKey, 'hex')
          });
        }
      }

      // Send the operations to be written atomically
      callback(null, operations);
    });

  });

};

/**
 * This function is responsible for emitting events to any subscribers to the
 * `address/transaction` event.
 * @param {Object} obj
 * @param {Transaction} obj.tx - The transaction
 * @param {Object} obj.addressInfo
 * @param {String} obj.addressInfo.hashHex - The hex string of address hash for the subscription
 * @param {String} obj.addressInfo.hashBuffer - The address hash buffer
 * @param {String} obj.addressInfo.addressType - The address type
 * @param {Array} obj.outputIndexes - Indexes of the inputs that includes the address
 * @param {Array} obj.inputIndexes - Indexes of the outputs that includes the address
 * @param {Date} obj.timestamp - The time of the block the transaction was included
 * @param {Number} obj.height - The height of the block the transaction was included
 * @param {Boolean} obj.rejected - If the transaction was not accepted in the mempool
 */
AddressService.prototype.transactionEventHandler = function(obj) {
  if(this.subscriptions['address/transaction'][obj.addressInfo.hashHex]) {
    var emitters = this.subscriptions['address/transaction'][obj.addressInfo.hashHex];
    var address = new Address({
      hashBuffer: obj.addressInfo.hashBuffer,
      network: this.node.network,
      type: obj.addressInfo.addressType
    });
    for(var i = 0; i < emitters.length; i++) {
      emitters[i].emit('address/transaction', {
        rejected: obj.rejected,
        height: obj.height,
        timestamp: obj.timestamp,
        inputIndexes: obj.inputIndexes,
        outputIndexes: obj.outputIndexes,
        address: address,
        tx: obj.tx
      });
    }
  }
};

/**
 * The function is responsible for emitting events to any subscribers for the
 * `address/balance` event.
 * @param {Block} block
 * @param {Object} obj
 * @param {String} obj.hashHex
 * @param {Buffer} obj.hashBuffer
 * @param {String} obj.addressType
 */
AddressService.prototype.balanceEventHandler = function(block, obj) {
  if(this.subscriptions['address/balance'][obj.hashHex]) {
    var emitters = this.subscriptions['address/balance'][obj.hashHex];
    var address = new Address({
      hashBuffer: obj.hashBuffer,
      network: this.node.network,
      type: obj.addressType
    });
    this.getBalance(address, true, function(err, balance) {
      if(err) {
        return this.emit(err);
      }
      for(var i = 0; i < emitters.length; i++) {
        emitters[i].emit('address/balance', address, balance, block);
      }
    });
  }
};

/**
 * The Bus will use this function to subscribe to the available
 * events for this service. For information about the available events
 * please see `getPublishEvents`.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An event emitter instance
 * @param {Array} addresses - An array of addresses to subscribe
 */
AddressService.prototype.subscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses), 'Second argument is expected to be an Array of addresses');

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(!this.subscriptions[name][hashHex]) {
      this.subscriptions[name][hashHex] = [];
    }
    this.subscriptions[name][hashHex].push(emitter);
  }
};

/**
 * The Bus will use this function to unsubscribe to the available
 * events for this service.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An event emitter instance
 * @param {Array} addresses - An array of addresses to subscribe
 */
AddressService.prototype.unsubscribe = function(name, emitter, addresses) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');
  $.checkArgument(Array.isArray(addresses) || _.isUndefined(addresses), 'Second argument is expected to be an Array of addresses or undefined');

  if(!addresses) {
    return this.unsubscribeAll(name, emitter);
  }

  for(var i = 0; i < addresses.length; i++) {
    var hashHex = bitcore.Address(addresses[i]).hashBuffer.toString('hex');
    if(this.subscriptions[name][hashHex]) {
      var emitters = this.subscriptions[name][hashHex];
      var index = emitters.indexOf(emitter);
      if(index > -1) {
        emitters.splice(index, 1);
      }
    }
  }
};

/**
 * A helper function for the `unsubscribe` method to unsubscribe from all addresses.
 * @param {String} name - The name of the event
 * @param {EventEmitter} emitter - An instance of an event emitter
 */
AddressService.prototype.unsubscribeAll = function(name, emitter) {
  $.checkArgument(emitter instanceof EventEmitter, 'First argument is expected to be an EventEmitter');

  for(var hashHex in this.subscriptions[name]) {
    var emitters = this.subscriptions[name][hashHex];
    var index = emitters.indexOf(emitter);
    if(index > -1) {
      emitters.splice(index, 1);
    }
  }
};

AddressService.prototype.getTransactionCount = function(addressArg, queryMempool, callback) {
  // TODO: mempool

  var address = new Address(addressArg);
  var hashTypeBuffer = constants.HASH_TYPES_MAP[address.type];
  var summaryKey = encoding.encodeSummaryKey(address.hashBuffer, hashTypeBuffer);

  this.node.services.db.store.get(summaryKey, {
    valueEncoding: 'binary'
  }, function(err, addressSummary) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback(null, 0);
    } else if (err) {
      return callback(err);
    }
    var txCount = addressSummary.readUInt32BE(24);
    callback(null, txCount);
  });
};

/**
 * Will sum the total of all unspent outputs to calculate the balance
 * for an address.
 * @param {String} address - The base58check encoded address
 * @param {Boolean} queryMempool - Include mempool in the results
 * @param {Function} callback
 */
AddressService.prototype.getBalance = function(addressArg, queryMempool, callback) {
  // TODO: mempool

  var address = new Address(addressArg);
  var hashTypeBuffer = constants.HASH_TYPES_MAP[address.type];
  var summaryKey = encoding.encodeSummaryKey(address.hashBuffer, hashTypeBuffer);

  this.node.services.db.store.get(summaryKey, {
    valueEncoding: 'binary'
  }, function(err, balanceValue) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback(null, {
        balance: 0,
        received: 0,
        change: 0
      });
    } else if (err) {
      return callback(err);
    }
    var balance = balanceValue.readDoubleBE();
    var received = balanceValue.readDoubleBE(8);
    var change = balanceValue.readDoubleBE(16);
    var txCount = balanceValue.readUInt32BE(24);
    callback(null, {
      balance: balance,
      received: received,
      change: change,
      transactionCount: txCount
    });
  });
};

/**
 * Will give the input that spends an output if it exists with:
 *   inputTxId - The input txid hex string
 *   inputIndex - A number with the spending input index
 * @param {String|Buffer} txid - The transaction hash with the output
 * @param {Number} outputIndex - The output index in the transaction
 * @param {Object} options
 * @param {Object} options.queryMempool - Include mempool in results
 * @param {Function} callback
 */
AddressService.prototype.getInputForOutput = function(txid, outputIndex, options, callback) {
  $.checkArgument(_.isNumber(outputIndex));
  $.checkArgument(_.isObject(options));
  $.checkArgument(_.isFunction(callback));
  var self = this;
  var txidBuffer;
  if (Buffer.isBuffer(txid)) {
    txidBuffer = txid;
  } else {
    txidBuffer = new Buffer(txid, 'hex');
  }
  if (options.queryMempool) {
    var spentIndexSyncKey = encoding.encodeSpentIndexSyncKey(txidBuffer, outputIndex);
    if (this.mempoolSpentIndex[spentIndexSyncKey]) {
      return this._getSpentMempool(txidBuffer, outputIndex, callback);
    }
  }
  var key = encoding.encodePrevOutputKey(txidBuffer, outputIndex);
  this.node.services.db.store.get(key, {
    valueEncoding: 'binary'
  }, function(err, buffer) {
    if (err instanceof levelup.errors.NotFoundError) {
      return callback(null, false);
    } else if (err) {
      return callback(err);
    }
    // TODO decode prev output buffer to only get txid and inputIndex
    var inputTxId = '';
    var inputIndex = '';
    callback(null, {
      inputTxId: inputTxId.toString('hex'),
      inputIndex: inputIndex
    });
  });
};

AddressService.prototype._getInputsMempool = function(addressStr, hashBuffer, hashTypeBuffer, callback) {
  var self = this;
  var mempoolInputs = [];

  var stream = self.mempoolIndex.createReadStream({
    gte: Buffer.concat([
      constants.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MIN
    ]),
    lte: Buffer.concat([
      constants.MEMPREFIXES.SPENTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    var txid = data.value.slice(0, 32);
    var inputIndex = data.value.readUInt32BE(32);
    var timestamp = data.value.readDoubleBE(36);
    var input = {
      address: addressStr,
      hashType: constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      inputIndex: inputIndex,
      timestamp: timestamp,
      height: -1,
      confirmations: 0
    };
    mempoolInputs.push(input);
  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('close', function() {
    if (error) {
      return callback(error);
    }
    callback(null, mempoolInputs);
  });

};

AddressService.prototype._getSpentMempool = function(txidBuffer, outputIndex, callback) {
  var outputIndexBuffer = new Buffer(4);
  outputIndexBuffer.writeUInt32BE(outputIndex);
  var spentIndexKey = Buffer.concat([
    constants.MEMPREFIXES.SPENTSMAP,
    txidBuffer,
    outputIndexBuffer
  ]);

  this.mempoolIndex.get(
    spentIndexKey,
    function(err, mempoolValue) {
      if (err) {
        return callback(err);
      }
      var inputTxId = mempoolValue.slice(0, 32);
      var inputIndex = mempoolValue.readUInt32BE(32);
      callback(null, {
        inputTxId: inputTxId.toString('hex'),
        inputIndex: inputIndex
      });
    }
  );
};

AddressService.prototype._getOutputsMempool = function(addressStr, hashBuffer, hashTypeBuffer, callback) {
  var self = this;
  var mempoolOutputs = [];

  var stream = self.mempoolIndex.createReadStream({
    gte: Buffer.concat([
      constants.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MIN
    ]),
    lte: Buffer.concat([
      constants.MEMPREFIXES.OUTPUTS,
      hashBuffer,
      hashTypeBuffer,
      constants.SPACER_MAX
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    // Format of data:
    // prefix: 1, hashBuffer: 20, hashTypeBuffer: 1, txid: 32, outputIndex: 4
    var txid = data.key.slice(22, 54);
    var outputIndex = data.key.readUInt32BE(54);
    var value = encoding.decodeOutputMempoolValue(data.value);
    var output = {
      address: addressStr,
      hashType: constants.HASH_TYPES_READABLE[hashTypeBuffer.toString('hex')],
      txid: txid.toString('hex'), //TODO use a buffer
      outputIndex: outputIndex,
      height: -1,
      timestamp: value.timestamp,
      satoshis: value.satoshis,
      script: value.scriptBuffer.toString('hex'), //TODO use a buffer
      confirmations: 0
    };
    mempoolOutputs.push(output);
  });

  var error;

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('close', function() {
    if (error) {
      return callback(error);
    }
    callback(null, mempoolOutputs);
  });

};

/**
 *   txid - A string of the transaction hash
 *   outputIndex - A number of corresponding transaction output
 *   height - The height of the block the transaction was included, will be -1 for mempool transactions
 *   satoshis - The satoshis value of the output
 *   script - The script of the output as a hex string
 *
 * Will give unspent outputs for an address or an array of addresses.
 * @param {Array|String} addresses - An array of addresses
 * @param {Object} options
 * @param {Boolean} options.queryMempool - Include or exclude the mempool
 * @param {Function} callback
 */
AddressService.prototype.getUnspentOutputs = function(addressArg, options, callback) {
  //TODO: multiple addresses
  //TODO: queryMempool option
  var self = this;
  var address = new Address(addressArg);

  var utxos = [];
  var count = 0;
  var from = options.from || 0;
  var to = options.to || constants.PAGE_SIZE;
  if (to < from) {
    return callback(new Error('"to" option can not be less than "from"'));
  }

  var addressKey = Buffer.concat([
    constants.PREFIXES.UNSPENT,
    address.hashBuffer,
    constants.HASH_TYPES_MAP[address.type]
  ]);
  var stream = this.node.services.db.store.createKeyStream({
    gt: Buffer.concat([addressKey, constants.SPACER_MIN]),
    lt: Buffer.concat([addressKey, constants.SPACER_MAX]),
    keyEncoding: 'binary'
  });
  stream.on('data', function(key) {
    if (count >= from && count < to) {
      var offset = constants.PREFIX_SIZE + constants.ADDRESS_KEY_SIZE + constants.SPACER_SIZE;
      var height = key.readUInt32BE(offset);
      var txidEndOffset = offset + constants.HEIGHT_SIZE + constants.TXID_SIZE;
      var txid = key.slice(offset + constants.HEIGHT_SIZE, txidEndOffset);
      var outputIndex = key.readUInt32BE(txidEndOffset);
      utxos.push([height, txid, outputIndex]);
    } else if (count > to) {
      stream.push(null);
    }
  });

  var error;

  stream.on('error', function(err) {
    log.error(err);
    error = err;
  });

  stream.on('end', function() {
    if (error) {
      return callback(error);
    }
    // TODO: do many at once and keep order?
    async.mapSeries(utxos, getDetails, callback);
  });

  function getDetails(utxo, next) {
    var height = utxo[0];
    var txid = utxo[1];
    var outputIndex = utxo[2];
    var prevOutputKeyBuffer = encoding.encodePrevOutputKey(txid, outputIndex);
    self.node.services.db.store.get(prevOutputKeyBuffer, {
      keyEncoding: 'binary'
    }, function(err, buffer) {
      var satoshis = buffer.readDoubleBE(21);
      var script = buffer.read();// TODO
      var details = {
        txid: txid,
        outputIndex: outputIndex,
        height: height,
        satoshis: satoshis,
        script: script
      };
      next(null, details);
    });
  }

};


/**
 * This will give the history for many addresses limited by a range of block heights (to limit
 * the database lookup times) and/or paginated to limit the results length.
 *
 * The response format will be:
 * {
 *   totalCount: 12 // the total number of items there are between the two heights
 *   items: [
 *     {
 *       addresses: {
 *         '12c6DSiU4Rq3P4ZxziKxzrL5LmMBrzjrJX': {
 *           inputIndexes: [],
 *           outputIndexes: [0]
 *         }
 *       },
 *       satoshis: 100,
 *       height: 300000,
 *       confirmations: 1,
 *       timestamp: 1442337090 // in seconds
 *       fees: 1000 // in satoshis
 *       tx: <Transaction>
 *     }
 *   ]
 * }
 * @param {Array} addresses - An array of addresses
 * @param {Object} options - The options to limit the query
 * @param {Number} [options.from] - The pagination "from" index
 * @param {Number} [options.to] - The pagination "to" index
 * @param {Number} [options.start] - The beginning block height (e.g. 1500 the most recent block height).
 * @param {Number} [options.end] - The ending block height (e.g. 0 the older block height, results are inclusive).
 * @param {Boolean} [options.queryMempool] - Include the mempool in the query
 * @param {Function} callback
 */
AddressService.prototype.getAddressHistory = function(addresses, options, callback) {
  var history = new AddressHistory({
    node: this.node,
    options: options,
    addresses: addresses
  });
  history.get(callback);
};

AddressService.prototype.getTransactionIds = function(addressArg, options, callback) {
  // TODO: optional mempool
  // TODO: optional buffer txids

  var address = new Address(addressArg);
  var hashTypeBuffer = constants.HASH_TYPES_MAP[address.type];
  var addressKey = encoding.encodeAddressTxIdKey(address.hashBuffer, hashTypeBuffer);

  var stream = this.node.services.db.store.createKeyStream({
    gt: Buffer.concat([addressKey, constants.SPACER_MIN]),
    lt: Buffer.concat([addressKey, constants.SPACER_MAX]),
    keyEncoding: 'binary'
  });

  var txids = [];
  var count = 0;
  var from = options.from || 0;
  var to = options.to || constants.PAGE_SIZE;
  if (to < from) {
    return callback(new Error('"to" option can not be less than "from"'));
  }

  stream.on('data', function(keyData) {
    // TODO: optionally include height details
    if (count >= from && count < to) {
      var offset = constants.PREFIX_SIZE + constants.ADDRESS_KEY_SIZE + constants.SPACER_SIZE;
      var height = keyData.readUInt32BE(offset);
      var valueSize = constants.HEIGHT_SIZE + constants.TXID_SIZE;
      var txid = keyData.slice(offset + constants.HEIGHT_SIZE, offset + valueSize);
      txids.push(txid.toString('hex'));
    } else if (count > to) {
      stream.push(null);
    }
    count++;
  });

  var error;

  stream.on('error', function(err) {
    log.error(err);
    error = err;
  });

  stream.on('end', function() {
    if (error) {
      return callback(error);
    }
    callback(null, txids);
  });

};

AddressService.prototype.getAddressSummary = function(addressArg, options, callback) {
  // TODO: optional mempool
  var self = this;
  var summary = {};
  var address = new Address(addressArg);

  if (_.isUndefined(options.queryMempool)) {
    options.queryMempool = true;
  }

  function getBalance(done) {
    self.getBalance(address, options, function(err, data) {
      if (err) {
        return done(err);
      }
      summary.totalReceived = data.received;
      summary.totalSpent = data.received - data.balance;
      summary.balance = data.balance;
      summary.change = data.change;
      summary.appearances = data.transactionCount;
      done();
    });
  }

  function getTxList(done) {
    // todo: fullTxList option
    self.getTransactionIds(address, options, function(err, txids) {
      if (err) {
        return done(err);
      }
      summary.txids = txids;
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

module.exports = AddressService;
