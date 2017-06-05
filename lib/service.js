'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var LRU = require('lru-cache');
var assert = require('assert');

var Service = function(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.name = options.name;
};

util.inherits(Service, EventEmitter);

/**
 * Describes the dependencies that should be loaded before this service.
 */
Service.dependencies = [];

/**
 * blockHandler
 * @param {Block} block - the block being added or removed from the chain
 * @param {Boolean} add - whether the block is being added or removed
 * @param {Function} callback - call with the leveldb database operations to perform
 */
Service.prototype.blockHandler = function(block, add, callback) {
  // implement in the child class
  setImmediate(function() {
    callback(null, []);
  });
};

/**
 * the bus events available for subscription
 * @return {Array} an array of event info
 */
Service.prototype.getPublishEvents = function() {
  // Example:
  // return [
  //   ['eventname', this, this.subscribeEvent, this.unsubscribeEvent],
  // ];
  return [];
};

/**
 * the API methods to expose
 * @return {Array} return array of methods
 */
Service.prototype.getAPIMethods = function() {
  // Example:
  // return [
  //   ['getData', this, this.getData, 1]
  // ];

  return [];
};

// Example:
// Service.prototype.getData = function(arg1, callback) {
//
// };

/**
 * Function which is called when module is first initialized
 */
Service.prototype.start = function(done) {
  setImmediate(done);
};

/**
 * Function to be called when bitcore-node is stopped
 */
Service.prototype.stop = function(done) {
  setImmediate(done);
};

/**
 * Setup express routes
 * @param  {Express} app
 */
Service.prototype.setupRoutes = function() {
  // Setup express routes here
};

Service.prototype.getRoutePrefix = function() {
  return this.name;
};

Service.prototype._createConcurrencyCache = function(opts) {
  this._concurrencyCache = LRU(opts || 500);
};

Service.prototype._createCache = function(opts) {
  this._cache = LRU(opts || 500);
};

Service.prototype._retrieveCachedItems = function(key, valueItem, prevKey, fn) {
  var self = this;

  var prev = self._concurrencyCache.get(prevKey);

  if (prev && !prev.prevKey) {

    if (fn) {
      valueItem = fn.call(self, valueItem, prev.valueItem);
    }

    self._concurrencyCache.del(prevKey);
    self._concurrencyCache.set(key, { valueItem: valueItem });
    return [{ key: key, value: valueItem }];
  }

  self._concurrencyCache.set(key, { valueItem: valueItem, prevKey: prevKey });

  var resolvedDeps = [];
  var depKey = key;

  self._concurrencyCache.rforEach(function(value, key) {

    if (depKey === value.prevKey) {

      valueItem = fn.call(self, value.valueItem, depKey.valueItem);
      resolvedDeps.push({ key: key, value: valueItem });
      depKey = key;
      self._concurrencyCache.del(key);

    }
  });

  return resolvedDeps;
};

Service.prototype._getGenesisBlock = function() {

  this.genesis = {};
  this.genesis.height = 0;
  this.genesis.hash = constants.BITCOIN_GENESIS_HASH[this.node.getNetworkName()];
  return this.genesis;

};

Service.prototype._decodeTipData = function(tipBuf) {

  assert(tipBuf && Buffer.isBuffer(tipBuf) && tipBuf.length === 36,
    'tip data: ' + tipBuf.toString('hex') + ' if not in the proper format');

  var hash = tipBuf.slice(0, 32).toString('hex');
  var height = tipBuf.slice(32).toString('hex').readUInt32BE();
  return {
    hash: hash,
    height: height
  };
};

Service.prototype._loadTip = function(callback) {

  var self = this;

  self.db.get(new Buffer('00', 'hex') + self.name, function(err, tipBuf) {

    if (err) {
      return callback(err);
    }

    if (!tipBuf) {
      self.tip = self._getGenesisBlock();
      return callback();
    }

    self.tip = self._decodeTipData(tipData);

    log.info('Loaded tip for: ' + self.name + ' service, hash: ' +
      self.tip.hash + ' height: ' + self.tip.height);

    callback();

  });


};

module.exports = Service;
