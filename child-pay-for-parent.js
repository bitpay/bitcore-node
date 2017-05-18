var unmentionables = require('./keys.json');
var assert = require('assert');
var p2p = require('bitcore-p2p');
var Peer = p2p.Peer;
var messages = new p2p.Messages();

var peer = new Peer({host: '68.101.164.118'});

// 1.  prepare a low fee ts.
// 2.  send low fee tx. The low fee tx should be enough to be relayed
// 3.  20 - 50 sats/byte is what we usually see
// 4.  later, spend those outputs using an approproate fee

var bitcore = require('bitcore-lib');
var key1 = new bitcore.PrivateKey(unmentionables.key1);
var key2 = new bitcore.PrivateKey(unmentionables.key2);
var lowFeeRate = 40; //sat/byte
var highFeeRate = 260;

var parentUtxo = {
  txid: '100304043f19ea9c4faf0810c9432b806cf383de38d9138b004c8a8df7f76249',
  outputIndex: 0,
  address: '1DxgVtn7xUwX9Jwqx7YW7JfsDDDVHDxTwL',
  script: '76a9148e295bd3b705aac6ba0cb02bb582f98c451b83ee88ac',
  satoshis: 17532710
};

var parentTx = new bitcore.Transaction();

var lowFee = lowFeeRate*193;
var highFee = highFeeRate*193;
var childToAddress = '12Awugz6fhM2BW4dH7Xx1ZKxy3CHWM6a8f';

parentTx.from(parentUtxo).to(childToAddress, (parentUtxo.satoshis - lowFee)).fee(lowFee).sign(key1);
console.log(parentTx.getFee());
console.log(parentTx.verify());
assert((parentTx.inputs[0].output.satoshis - parentTx.outputs[0].satoshis) === parentTx.getFee());

console.log(parentTx.toObject());
console.log(parentTx.serialize());

peer.on('ready', function() {
  console.log(peer.version, peer.subversion, peer.bestHeight);
  setTimeout(function() {
    peer.sendMessage(messages.Transaction(parentTx));
    setTimeout(function() { peer.disconnect(); }, 2000);
  }, 2000);
});

peer.on('disconnect', function() {
  console.log('connection closed');
});
peer.connect();
//var childUtxo = {
//  txid: parentTx.id,
//  outputIndex: 0,
//  address: childToAddress,
//  script: parentTx.outputs[0].script.toHex(),
//  satoshis: (parentUtxo.satoshis - lowFee)
//};
//
//var childTx = new bitcore.Transaction();
//childTx.from(childUtxo).to(childToAddress, (childUtxo.satoshis - highFee)).fee(highFee).sign(key2);
//console.log(childTx.getFee());
//console.log(childTx.toObject());





//01000000
//01
//49
//62f7f78d8a4c008b13d938de83f36c802b43c91008af4f9cea193f04040310000000006a47304402200c98dee6e5a2db276e24ac45c153aa5586455894efee060e95e0e7d017569df30220258b48ebd0253ca6b4b8b35d8f18b4bcb41040fb060f1ed59f7989185dd296170121031c8ed8aead402b7f6e02617d50b7a7ba3b07a489da0702f65f985bf0ebb64f3a
//ffffffff
//01
//26
//87
//0b01000000001976a9140cd9b466eb74f45e3290b47fbbb622e458601267
//88
//ac
//00000000

