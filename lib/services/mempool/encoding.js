'use strict';

var tx = require('bcoin').tx;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
}

Encoding.prototype.encodeMempoolTransactionKey = function(txid) {
  var buffers = [this.servicePrefix];
  var txidBuffer = new Buffer(txid, 'hex');
  buffers.push(txidBuffer);
  return Buffer.concat(buffers);
};

Encoding.prototype.decodeMempoolTransactionKey = function(buffer) {
  return buffer.slice(2).toString('hex');
};

Encoding.prototype.encodeMempoolTransactionValue = function(transaction) {
  return transaction.toRaw();
};

Encoding.prototype.decodeMempoolTransactionValue = function(buffer) {
  return tx.fromRaw(buffer);
};

module.exports = Encoding;

