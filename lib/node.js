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

var genesisBlocks = require('./data/genesis');

var BitcoreNode = function(bus, networkMonitor, blockService, transactionService, addressService) {
  $.checkArgument(bus);
  $.checkArgument(networkMonitor);
  var self = this;
  this.bus = bus;
  this.networkMonitor = networkMonitor;

  this.addressService = addressService;
  this.transactionService = transactionService;
  this.blockService = blockService;

  this.bus.register(bitcore.Block, this.blockService.onBlock.bind(this.blockService));

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
  this.sync();
  this.networkMonitor.start();
};

BitcoreNode.prototype.sync = function() {
  var genesis = bitcore.Block.fromBuffer(genesisBlocks[bitcore.Networks.defaultNetwork.name]);
  var self = this;
  this.networkMonitor.on('ready', function() {
    console.log('ready');
    self.blockService.getLatest().then(function(latest) {
        var start = genesis.hash;
        console.log('latest', latest);
        if (latest) {
          start = latest.hash;
        }
        console.log('Starting sync from', start);
        self.networkMonitor.syncFrom(start);
      })
      .catch(function(err) {
        self.networkMonitor.stop();
        throw err;
      });
  });
};


module.exports = BitcoreNode;
