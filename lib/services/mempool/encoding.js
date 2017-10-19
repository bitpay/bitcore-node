'use strict';

var tx = require('bcoin').tx;

function Encoding(servicePrefix) {
  this.servicePrefix = servicePrefix;
  this.txPrefix = new Buffer('00', 'hex');
  this.addressPrefix = new Buffer('01', 'hex');
}

Encoding.prototype.encodeMempoolTransactionKey = function(txid) {
  var buffers = [this.servicePrefix, this.txPrefix];
  var txidBuffer = new Buffer(txid, 'hex');
  buffers.push(txidBuffer);
  return Buffer.concat(buffers);
};

Encoding.prototype.decodeMempoolTransactionKey = function(buffer) {
  return buffer.slice(3).toString('hex');
};

Encoding.prototype.encodeMempoolTransactionValue = function(transaction) {
  return transaction.toRaw();
};

Encoding.prototype.decodeMempoolTransactionValue = function(buffer) {
  return tx.fromRaw(buffer);
};

Encoding.prototype.encodeMempoolAddressKey = function(address, txid, index, input) {
  var buffers = [this.servicePrefix, this.addressPrefix];

  var addressSizeBuffer = new Buffer(1);
  addressSizeBuffer.writeUInt8(address.length);
  var addressBuffer = new Buffer(address, 'utf8');

  buffers.push(addressSizeBuffer);
  buffers.push(addressBuffer);

  var txidBuffer = new Buffer(txid || Array(65).join('0'), 'hex');
  buffers.push(txidBuffer);

  var indexBuffer = new Buffer(4);
  indexBuffer.writeUInt32BE(index || 0);
  buffers.push(indexBuffer);

  // this is whether the address appears in an input (1) or output (0)
  var inputBuffer = new Buffer(1);
  inputBuffer.writeUInt8(input || 0);
  buffers.push(inputBuffer);

  return Buffer.concat(buffers);

};

Encoding.prototype.decodeMempoolAddressKey = function(buffer) {

  var addressSize = buffer.readUInt8(3);
  var address = buffer.slice(4, addressSize + 4).toString('utf8');

  var txid = buffer.slice(addressSize + 4, addressSize + 36).toString('hex');

  var index = buffer.readUInt32BE(addressSize + 36);

  var input = buffer.readUInt8(addressSize + 40);

  return {
    address: address,
    txid: txid,
    index: index,
    input: input
  };

};

module.exports = Encoding;

