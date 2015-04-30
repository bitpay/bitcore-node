'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;
var pjson = require('../package.json');

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Promise = require('bluebird');
var RPC = require('bitcoind-rpc');

var NetworkMonitor = require('./networkmonitor');
var EventBus = require('./eventbus');

var LevelUp = require('levelup');
var BlockService = require('./services/block');
var TransactionService = require('./services/transaction');
var AddressService = require('./services/address');

var BlockChain = require('./blockchain');
var genesisBlocks = require('./data/genesis');

var BitcoreNode = function(bus, networkMonitor, blockService, transactionService, addressService) {
  $.checkArgument(bus, 'bus is required');
  $.checkArgument(networkMonitor, 'networkMonitor is required');
  $.checkArgument(blockService, 'blockService is required');
  $.checkArgument(transactionService, 'transactionService is required');
  $.checkArgument(addressService, 'addressService is required');
  this.bus = bus;
  this.networkMonitor = networkMonitor;

  this.tip = null;

  this.addressService = addressService;
  this.transactionService = transactionService;
  this.blockService = blockService;

  this.blockCache = {};
  this.initialize();
};
util.inherits(BitcoreNode, EventEmitter);

BitcoreNode.create = function(opts) {
  opts = opts || {};

  var bus = new EventBus();

  var networkMonitor = NetworkMonitor.create(bus, opts.NetworkMonitor);

  var database = opts.database || Promise.promisifyAll(
    new LevelUp(opts.LevelUp || './db')
  );
  var rpc = opts.rpc || Promise.promisifyAll(new RPC(opts.RPC));

  var transactionService = opts.transactionService || new TransactionService({
    rpc: rpc,
    database: database
  });
  var blockService = opts.blockService || new BlockService({
    rpc: rpc,
    database: database,
    transactionService: transactionService
  });
  var addressService = opts.addressService || new AddressService({
    rpc: rpc,
    database: database,
    transactionService: transactionService,
    blockService: blockService
  });
  return new BitcoreNode(bus, networkMonitor, blockService, transactionService, addressService);
};


BitcoreNode.prototype.initialize = function() {
  var self = this;


  var prevHeight = 0;
  var statTimer = 5 * 1000;
  this.interval = setInterval(function() {
    if (!self.blockchain) {
      // not ready yet
      console.log('No blockchain yet');
      return;
    }
    var tipHash = self.blockchain.tip;
    var block = self.blockCache[tipHash];
    if (_.isUndefined(block)) {
      console.log('No blocks yet');
      return;
    }
    var delta = block.height - prevHeight;
    prevHeight = block.height;
    console.log(block.id, block.height, 'vel', delta * 1000 / statTimer, 'b/s',
      100 * self.getSyncProgress() + '% synced');
  }, statTimer);

  this.bus.register(bitcore.Block, function(block) {

    var prevHash = bitcore.util.buffer.reverse(block.header.prevHash).toString('hex');
    self.blockCache[block.hash] = block;
    if (!self.blockchain.hasData(prevHash)) {
      self._requestFromTip();
      return;
    }
    var blockchainChanges = self.blockchain.proposeNewBlock(block);

    // Annotate block with extra data from the chain
    block.height = self.blockchain.height[block.id];
    block.work = self.blockchain.work[block.id];

    return Promise.each(blockchainChanges.unconfirmed, function(hash) {
        return self.blockService.unconfirm(self.blockCache[hash]);
      })
      .then(function() {
        return Promise.all(blockchainChanges.confirmed.map(function(hash) {
          return self.blockService.confirm(self.blockCache[hash]);
        }));
      })
      .then(function() {
        var deleteHeight = block.height - 100;
        if (deleteHeight > 0) {
          var deleteHash = self.blockchain.hashByHeight[deleteHeight];
          delete self.blockCache[deleteHash];
        }
      })
      .catch(function(error) {
        self.stop(error);
      });
  });

  this.bus.onAny(function(value) {
    self.emit(this.event, value);
  });
  this.networkMonitor.on('error', function(err) {
    self.emit('error', err);
  });
  this.networkMonitor.on('disconnect', function() {
    console.log('network monitor disconnected');
  });
};

BitcoreNode.prototype.start = function() {
  var self = this;
  var genesis = bitcore.Block.fromBuffer(genesisBlocks[bitcore.Networks.defaultNetwork.name]);

  return this.probeRPC()
    .catch(function(err) {
      console.log('RPC connection unsuccessful. Please check your configuration');
      throw err;
    })
    .then(function() {
      return self.blockService.getBlockchain();
    })
    .then(function(blockchain) {
      if (!blockchain) {
        self.blockchain = new BlockChain();
        self.bus.process(genesis);
      } else {
        self.blockchain = blockchain;
      }
      self.sync();
      return self.networkMonitor.start();
    });
};

BitcoreNode.prototype.stop = function(reason) {
  clearInterval(this.interval);
  this.networkMonitor.abort(reason);
  return this.blockService.database.closeAsync();
};


BitcoreNode.prototype.probeRPC = function() {
  // TODO: nicer way to do this?
  console.log('Probing RPC connection to check health...');
  return this.blockService.rpc.getBlockHashAsync(1)
    .then(function() {
      return true;
    });
};

BitcoreNode.prototype.getStatus = function() {
  return Promise.resolve({
    sync: this.getSyncProgress(),
    peerCount: this.networkMonitor.getConnectedPeers(),
    version: pjson.version,
    network: bitcore.Networks.defaultNetwork.name,
    height: this.getCurrentHeight(),
  });
};

BitcoreNode.prototype.getCurrentHeight = function() {
  if (!this.blockchain) {
    return 0;
  }
  return this.blockchain.getCurrentHeight();
};

BitcoreNode.prototype.getSyncProgress = function() {
  return !_.isUndefined(this.reportedMaxHeight) ?
    (this.blockchain.getCurrentHeight() / this.reportedMaxHeight) : 0;
};

BitcoreNode.prototype._requestFromTip = function() {
  var locator = this.blockchain.getBlockLocator();
  this.networkMonitor.requestBlocks(locator);
};


BitcoreNode.prototype.broadcast = function(tx) {
  $.checkArgument(tx instanceof bitcore.Transaction, 'tx must be a Transaction object');
  return this.networkMonitor.broadcast(tx);
};

BitcoreNode.prototype.sync = function() {
  var self = this;
  this.networkMonitor.on('ready', function(reportedMaxHeight) {
    self.reportedMaxHeight = reportedMaxHeight;
    self._requestFromTip();
  });
};

var errors = require('./errors');
BitcoreNode.errors = errors;
module.exports = BitcoreNode;
