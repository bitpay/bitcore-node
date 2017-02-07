'use strict';

var bitcore = require('bitcore-lib');

var Encoding = require('../../../lib/services/wallet-api/encoding');

describe('Wallet-Api service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var encoding = new Encoding(servicePrefix);
  var walletId = 'abcdef123456';
  var txid = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var address = '1EZBqbJSHFKSkVPNKzc5v26HA6nAHiTXq6';
  var height = 1;
  var addressSizeBuf = new Buffer(1);
  addressSizeBuf.writeUInt8(address.length);
  var outputIndex = 5;
  var txHex = '0100000001cc3ffe0638792c8b39328bb490caaefe2cf418f2ce0144956e0c22515f29724d010000006a473044022030ce9fa68d1a32abf0cd4adecf90fb998375b64fe887c6987278452b068ae74c022036a7d00d1c8af19e298e04f14294c807ebda51a20389ad751b4ff3c032cf8990012103acfcb348abb526526a9f63214639d79183871311c05b2eebc727adfdd016514fffffffff02f6ae7d04000000001976a9144455183e407ee4d3423858c8a3275918aedcd18e88aca99b9b08010000001976a9140beceae2c29bfde08d2b6d80b33067451c5887be88ac00000000';
  var tx = new bitcore.Transaction(txHex);
  var sats = tx.outputs[0].satoshis;
  var satsBuf = new Buffer(8);
  satsBuf.writeDoubleBE(sats);

  it('should encode wallet transaction key' , function() {
    encoding.encodeWalletTransactionKey(walletId, height).should.deep.equal(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.transaction.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      new Buffer('00000001', 'hex')
    ]));
  });

  it('should decode wallet transaction key', function() {
    var walletTransactionKey = encoding.decodeWalletTransactionKey(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.transaction.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      new Buffer('00000001', 'hex')
    ]));
    walletTransactionKey.walletId.should.equal(walletId);
    walletTransactionKey.height.should.equal(height);
  });

  it('should encode wallet transaction value', function() {
    encoding.encodeWalletTransactionValue(txid).should.deep.equal(new Buffer(txid, 'hex'));
  });

  it('should decode wallet transaction value', function() {
    encoding.decodeWalletTransactionValue(new Buffer(txid, 'hex')).should.equal(txid);
  });

  it('should encode wallet utxo key', function() {
    encoding.encodeWalletUtxoKey(walletId, txid, outputIndex).should.deep.equal(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.utxo.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      new Buffer(txid, 'hex'),
      new Buffer('00000005', 'hex')]));
  });

  it('should decode wallet utxo key', function() {
    var walletUtxoKey = encoding.decodeWalletUtxoKey(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.utxo.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      new Buffer(txid, 'hex'),
      new Buffer('00000005', 'hex')]));
    walletUtxoKey.walletId.should.equal(walletId);
    walletUtxoKey.txid.should.equal(txid);
    walletUtxoKey.outputIndex.should.equal(outputIndex);
  });

  it('should encode wallet utxo value', function() {
    encoding.encodeWalletUtxoValue(height, sats, tx.outputs[0]._scriptBuffer).should.deep.equal(Buffer.concat([
      new Buffer('00000001', 'hex'),
      satsBuf,
      tx.outputs[0]._scriptBuffer]));
  });

  it('should decode wallet utxo value', function() {
    var walletUtxoValue = encoding.decodeWalletUtxoValue(Buffer.concat([
      new Buffer('00000001', 'hex'),
      satsBuf,
      tx.outputs[0]._scriptBuffer]));
    walletUtxoValue.height.should.equal(height);
    walletUtxoValue.satoshis.should.equal(sats);
    walletUtxoValue.script.should.deep.equal(tx.outputs[0]._scriptBuffer);
  });

  it('should encode wallet utxo satoshis key', function() {
    encoding.encodeWalletUtxoSatoshisKey(walletId, sats, txid, outputIndex).should.deep.equal(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.utxoSat.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      satsBuf,
      new Buffer(txid, 'hex'),
      new Buffer('00000005', 'hex')]));
  });

  it('should decode wallet utxo satoshis key', function() {
    var walletUtxoSatoshisKey = encoding.decodeWalletUtxoSatoshisKey(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.utxoSat.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId),
      satsBuf,
      new Buffer(txid, 'hex'),
      new Buffer('00000005', 'hex')]));
    walletUtxoSatoshisKey.walletId.should.equal(walletId);
    walletUtxoSatoshisKey.satoshis.should.equal(sats);
    walletUtxoSatoshisKey.txid.should.equal(txid);
    walletUtxoSatoshisKey.outputIndex.should.equal(outputIndex);
  });

  it('should encode wallet utxo satoshis value', function() {
    encoding.encodeWalletUtxoSatoshisValue(height, tx.outputs[0]._scriptBuffer).should.deep.equal(Buffer.concat([
      new Buffer('00000001', 'hex'),
      tx.outputs[0]._scriptBuffer
    ]));
  });

  it('should decode wallet utxo satoshis value', function() {
    var walletUtxoSatoshisValue = encoding.decodeWalletUtxoSatoshisValue(Buffer.concat([
      new Buffer('00000001', 'hex'),
      tx.outputs[0]._scriptBuffer
    ]));
    walletUtxoSatoshisValue.height.should.equal(height);
    walletUtxoSatoshisValue.script.should.deep.equal(tx.outputs[0]._scriptBuffer);
  });

  it('should encode wallet addresses key', function() {
    encoding.encodeWalletAddressesKey(walletId).should.deep.equal(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.addresses.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId)
    ]));
  });

  it('should decode wallet addresses key', function() {
    encoding.decodeWalletAddressesKey(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.addresses.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId)
    ])).should.equal(walletId);
  });

  it('should encode wallet addresses value', function() {
    encoding.encodeWalletAddressesValue(['a']).should.deep.equal(Buffer.concat([
      new Buffer('00000001', 'hex'),
      new Buffer('01', 'hex'),
      new Buffer('a')]));
  });

  it('should decode wallet addresses value', function() {
    encoding.decodeWalletAddressesValue(Buffer.concat([
      new Buffer('00000001', 'hex'),
      new Buffer('01', 'hex'),
      new Buffer('a')])).should.deep.equal(['a']);
  });

  it('should encode wallet balance key', function() {
    encoding.encodeWalletBalanceKey(walletId).should.deep.equal(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.balance.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId)
    ]));
  });

  it('should decode wallet balance key', function() {
    encoding.decodeWalletBalanceKey(Buffer.concat([
      servicePrefix,
      encoding.subKeyMap.balance.buffer,
      new Buffer('0c', 'hex'),
      new Buffer(walletId)
    ])).should.equal(walletId);
  });

  it('should encode wallet balance value', function() {
    encoding.encodeWalletBalanceValue(sats).should.deep.equal(satsBuf);
  });

  it('should decode wallet balance value', function() {
    encoding.decodeWalletBalanceValue(satsBuf).should.equal(sats);
  });
});
