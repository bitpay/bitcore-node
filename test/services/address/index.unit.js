'use strict';

var should = require('chai').should();
var bitcore = require('bitcore-lib');
var Script = bitcore.Script;
var PrivateKey = bitcore.PrivateKey;


var AddressService = require('../../../lib/services/address');
var utils = require('../../../lib/utils');

describe('Address Service', function() {
  var address;

  var sig = new Buffer('3045022100e8b654c91770402bf35d207406c7d4967605f99478954c8030cf7060160b5c730220296690debdd354d5fa17a61379cfdce9fdea136a4b234664e41c1c7cd840098901', 'hex');

  var pks = [ new PrivateKey(), new PrivateKey() ];

  var pubKeys = [ pks[0].publicKey, pks[1].publicKey ];

  var scripts = {
    p2pkhIn: Script.buildPublicKeyHashIn(pubKeys[0], sig),
    p2pkhOut: Script.buildPublicKeyHashOut(pubKeys[0]),
    p2shIn: Script.buildP2SHMultisigIn(pubKeys, 2, [sig, sig]),
    p2shOut: Script.buildScriptHashOut(Script.fromAddress(pks[0].toAddress())),
    p2pkIn: Script.buildPublicKeyIn(sig),
    p2pkOut: Script.buildPublicKeyOut(pubKeys[0]),
    p2bmsIn: Script.buildMultisigIn(pubKeys, 2, [sig, sig]),
    p2bmsOut: Script.buildMultisigOut(pubKeys, 2)
  };


  before(function(done) {
    address = new AddressService({ node: { name: 'address' } });
    done();
  });

  it('should get an address from a script buffer', function() {
    var start = process.hrtime();
    for(var key in scripts) {
      var ret = address.getAddressString({ script: scripts[key] });
      console.log(ret);
    };

    console.log(utils.diffTime(start));

  });
});
