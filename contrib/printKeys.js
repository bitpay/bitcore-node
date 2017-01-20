'use strict';

var levelup = require('levelup');
var leveldown = require('leveldown');
var Encoding = require('../lib/services/address/encoding');
var dbPath = '/Users/patrick/.bitcore/bitcore-node.db';

var db = levelup(dbPath, {keyEncoding: 'binary', valueEncoding: 'binary'});

var prefix = new Buffer('0002', 'hex');
var encoding = new Encoding(prefix);
var address = '19k8nToWwMGuF4HkNpzgoVAYk4viBnEs5D';
var addressLength = new Buffer(1);
addressLength.writeUInt8(address.length);

//var startBuffer = prefix;
//var endBuffer = Buffer.concat([prefix, new Buffer('ff', 'hex')]);

var startBuffer = Buffer.concat([prefix, addressLength, new Buffer(address, 'utf8'), new Buffer('00', 'hex')]);
var endBuffer = Buffer.concat([prefix, addressLength, new Buffer(address, 'utf8'), new Buffer('ff', 'hex')]);

var stream = db.createReadStream({
  gte: startBuffer,
  lt: endBuffer
});

stream.on('data', function(data) {
  console.log(encoding.decodeAddressIndexKey(data.key), encoding.decodeAddressIndexValue(data.value));
  //console.log(data.key.toString('hex'), data.value.toString('hex'));
});

stream.on('end', function() {
  console.log('end');
});