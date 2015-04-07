'use strict';

var util = require('util');
var EventEmitter = require('eventemitter2').EventEmitter2;

var bitcore = require('bitcore');
var config = require('config');
var p2p = require('bitcore-p2p');
var messages = new p2p.Messages();
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
  $.checkArgument(bus);
  $.checkArgument(networkMonitor);
  var self = this;
  this.bus = bus;
  this.networkMonitor = networkMonitor;

  this.tip = null;

  this.addressService = addressService;
  this.transactionService = transactionService;
  this.blockService = blockService;

  this.blockCache = {};

  this.bus.register(bitcore.Block, function(block) {

    var prevHash = bitcore.util.buffer.reverse(block.header.prevHash).toString('hex');
    self.blockCache[block.hash] = block;

    if (!self.blockchain.hasData(prevHash)) {
      self.networkMonitor.requestBlocks(self.blockchain.getBlockLocator());
      return;
    }

    var blockchainChanges = self.blockchain.proposeNewBlock(block);
    Promise.series(blockchainChanges.unconfirmed.map(function(hash) {
      return self.blockService.unconfirm(self.blockCache[hash]);
    }))
    .then(Promise.series(blockchainChanges.confirmed.map(function(hash) {
      return self.blockService.confirm(self.blockCache[hash]);
    })))
    .then(function() {
      self.networkMonitor.requestBlocks(self.blockchain.getBlockLocator());
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
util.inherits(BitcoreNode, EventEmitter);

BitcoreNode.create = function(opts) {
  opts = opts || {};

  var bus = new EventBus();

  var networkMonitor = NetworkMonitor.create(bus, opts.NetworkMonitor);

  console.log(opts.LevelUp);
  var database = Promise.promisifyAll(
    new LevelUp(opts.LevelUp || config.get('LevelUp'))
  );
  var rpc = Promise.promisifyAll(new RPC(config.get('RPC')));

  var transactionService = new TransactionService({
    rpc: rpc,
    database: database
  });
  var blockService = new BlockService({
    rpc: rpc,
    database: database,
    transactionService: transactionService
  });
  var addressService = new AddressService({
    rpc: rpc,
    database: database,
    transactionService: transactionService,
    blockService: blockService
  });
  return new BitcoreNode(bus, networkMonitor, blockService, transactionService, addressService);
};

BitcoreNode.prototype.start = function() {
  var self = this;
  this.blockService.getBlockchain().then(function(blockchain) {
    if (!blockchain) {
      self.blockchain = new BlockChain();
      self.blockchain.setTip(genesis);
    }
    self.sync();
    self.networkMonitor.start();
  });
  this.networkMonitor.on('stop', function() {
    self.blockService.saveBlockchain(self.blockchain);
  });
};

BitcoreNode.prototype.stop = function() {
  this.networkMonitor.stop();
};


BitcoreNode.prototype.sync = function() {
  var self = this;
  this.networkMonitor.on('ready', function() {
    self.blockService.getBlockchain().then(function(blockchain) {
      self.networkMonitor.requestBlocks(self.blockchain.getBlockLocator());
    }).catch(function(err) {
      self.networkMonitor.stop();
      throw err;
    });
  });
};

module.exports = BitcoreNode;
