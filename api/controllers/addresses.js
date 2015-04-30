'use strict';

var bitcore = require('bitcore');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Address = bitcore.Address;

var Addresses = {};

var node;
Addresses.setNode = function(aNode) {
  node = aNode;
};


/*
 *  params
 */

/*
 * Finds an address' info by it's string representation
 */
Addresses.addressParam = function(req, res, next, address) {
  if (!Address.isValid(address, bitcore.Networks.defaultNetwork)) {
    res.status(422);
    res.send('/v1/addresses/ parameter must be a valid bitcoin address');
    return;
  }
  req.address = new Address(address);
  next();
};

/*
 * Parse address list
 */
Addresses.addressesParam = function(req, res, next, addresses) {
  var addrList = addresses.split(',');
  var allAddressesValid = _.every(addrList, function(addr) {
    return Address.isValid(addr);
  });

  if (!allAddressesValid) {
    res.status(422);
    res.send('/v1/addresses/ parameter must be a bitcoin address list');
    return;
  }
  req.addresses = addrList.map(function (a) {
    return new Address(a);
  });
  next();
};


/*
 * controllers
 */


/**
 * Gets an address information
 */
Addresses.get = function(req, res) {
  $.checkState(req.address instanceof Address);
  node.addressService.getSummary(req.address)
    .then(function(info) {
      res.send(info);
    });
};

/**
 * Gets an address utxos
 */
Addresses.utxos = function(req, res) {
  $.checkState(_.all(req.addresses, function(addr) {
    return addr instanceof Address;
  }));
  node.addressService.getUnspent(req.addresses)
    .then(function(utxos) {
      res.send(utxos);
    });
};

module.exports = Addresses;
