'use strict';
// pulls some rando utxos that can be used for testing

var levelup = require('levelup');
var leveldown = require('leveldown');
var Encoding = require('../lib/services/address/encoding');
var fs = require('fs');
var outputFile = '/tmp/large_amounts_utxos.json';
var addresses = [];

var dbLocation = process.argv[2];

console.log('Using db location: ', dbLocation);

var addressPrefix = new Buffer('0006', 'hex');

var startAddress = new Array(35).join('0');
var endAddress = new Array(35).join('f');

var store = levelup(leveldown(dbLocation), {
  keyEncoding: 'binary',
  valueEncoding: 'binary'
});

var encoding = new Encoding(addressPrefix);

var start = encoding.encodeUtxoIndexKey(startAddress);
var end = encoding.encodeUtxoIndexKey(endAddress);
var res = {};
var limit = 18000000;
var count = 0;

var stream = store.createReadStream({
  gte: start,
  lte: end
});


stream.on('data', function(data) {
  count++;
  limit--;
  if (limit <= 0) {
    stream.emit('end');
  }
  var key = encoding.decodeUtxoIndexKey(data.key);
  if (res[key.address] >= 1) {
    res[key.address]++;
  } else {
    res[key.address] = 1;
  }
});

stream.on('end', function() {
  Object.keys(res).map(function(key) {
    if (res[key] > 1000) {
      addresses.push(key);
    }
  });
  fs.writeFileSync(outputFile, JSON.stringify(addresses));
  console.log('total utxo count: ', count);
  console.log('done');
});

