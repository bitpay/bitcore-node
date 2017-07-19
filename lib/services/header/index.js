'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var utils = require('../../utils');
var constants = require('../../constants');

var HeaderService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
};

inherits(HeaderService, BaseService);

HeaderService.dependencies = [ 'p2p', 'db' ];


// --- public prototype functions
HeaderService.prototype.getAPIMethods = function() {

  var methods = [
    ['getAllHeaders', this, this.getHeaders, 0]
  ];

  return methods;

};

HeaderService.prototype.start = function(callback) {

  var self = this;

  self._db.getPrefix(self.name, function(err, prefix) {

    if(err) {
      return callback(err);
    }

    self._db.getServiceTip(self.name, function(err, tip) {

      if(err) {
        return callback(err);
      }

      self._tip = tip;
      self._encoding = new Encoding(prefix);
      self._setListeners();
      self._startSubscriptions();
      callback();

    });
  });
};

HeaderService.prototype.stop = function(callback) {
  callback();
};

HeaderService.prototype._startSubscriptions = function() {

  if (this._subscribed) {
    return;
  }

  this._subscribed = true;
  if (!this._bus) {
    this._bus = this.node.openBus({remoteAddress: 'localhost'});
  }

  this._bus.on('p2p/headers', this._onHeaders.bind(this));
  this._bus.subscribe('p2p/headers');
};

HeaderService.prototype._onHeaders = function(headers) {

  if (!headers || headers.length < 1) {
    return;
  }

  this._tip.hash = headers[headers.length - 1].hash;
  this._tip.height = this._tip.height + headers.length;

  var operations = this._getHeaderOperations(headers);

  var tipOps = utils.encodeTip(this._tip, this.name);

  operations.push({
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  });

  this._db.batch(operations);

  if (this._tip.height >= this._bestHeight) {
    log.info('Header download complete.');
    this.emit('headers');
    return;
  }

  this._sync();

};

HeaderService.prototype._getHeaderOperations = function(headers) {

  var self = this;
  return headers.map(function(header) {
    return {
      type: 'put',
      key: self._encoding.encodeHeaderKey(header.hash),
      value: self._encoding.encodeHeaderValue(header)
    };
  });

};

HeaderService.prototype._setListeners = function() {

  this._p2p.once('bestHeight', this._onBestHeight.bind(this));

};

HeaderService.prototype._onBestHeight = function(height) {
  this._bestHeight = height;
  this._startSync();
};

HeaderService.prototype._startSync = function() {

  this._numNeeded = this._bestHeight - this._tip.height;
  if (this._numNeeded <= 0) {
    return;
  }

  log.info('Gathering: ' + this._numNeeded + ' ' + 'header(s) from the peer-to-peer network.');

  this._p2pHeaderCallsNeeded = Math.ceil(this._numNeeded / 500);
  this._sync();

};

HeaderService.prototype._sync = function() {

  if (--this._p2pHeaderCallsNeeded > 0) {

    log.info('Headers download progress: ' + this._tip.height + '/' +
      this._numNeeded + '  (' + (this._tip.height / this._numNeeded*100).toFixed(2) + '%)');
    this._p2p.getHeaders({ startHash: this._tip.hash });
    return;

  }

};

HeaderService.prototype.getHeaders = function(callback) {

  var self = this;
  var results = [];
  var start = self._encoding.encodeHeaderKey(0);
  var stream = self._db.createReadStream(criteria);

  var streamErr;
  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    results.push({
      hash: self.__encoding.decodeHeaderKey(data.key),
      header: self._encoding.decodeHeaderValue(data.value)
    });
  });

  stream.on('end', function() {
    if (streamErr) {
      return streamErr;
    }
    callback(null, results);
  });

};

module.exports = HeaderService;

