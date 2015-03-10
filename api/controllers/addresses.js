'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Address = bitcore.Address;

var BitcoreNode = require('../../');

var Addresses = {};

var node;
Addresses.setNode = function(aNode) {
  node = aNode;
};


/*
 *  params
 */

/*
 * Finds a block by its hash
 */
Addresses.blockHashParam = function(req, res, next, blockHash) {
  node.getBlock(blockHash)
    .then(function(block) {
      req.block = block;
    })
    .then(next)
    .catch(BitcoreNode.errors.Addresses.NotFound, function() {
      res.status(404).send('Block with id ' + blockHash + ' not found');
    });
};

/*
 * Finds an address' info by it's string representation
 */
Addresses.addressParam = function(req, res, next, address) {
  if (!Address.isValid(address)) {
    res.status(422);
    res.send('/v1/addresses/ parameter must be a valid bitcoin address');
    return;
  }
  req.address = new Address(address);
  next();
};


/*
 * controllers
 */

Addresses.get = function(req, res) {
  $.checkState(req.address instanceof Address);
  node.getAddressInfo(req.address)
    .then(function(info) {
      res.send(info);
    });
};

module.exports = Addresses;
