'use strict';
var should = require('chai').should();
var Tx = require('bcoin').tx;

var Encoding = require('../../../lib/services/transaction/encoding');

describe('Transaction service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');

  var encoding = new Encoding(servicePrefix);
  var txid = '91b58f19b6eecba94ed0f6e463e8e334ec0bcda7880e2985c82a8f32e4d03add';
  var blockHash = txid;
  var txHex = '0100000001cc3ffe0638792c8b39328bb490caaefe2cf418f2ce0144956e0c22515f29724d010000006a473044022030ce9fa68d1a32abf0cd4adecf90fb998375b64fe887c6987278452b068ae74c022036a7d00d1c8af19e298e04f14294c807ebda51a20389ad751b4ff3c032cf8990012103acfcb348abb526526a9f63214639d79183871311c05b2eebc727adfdd016514fffffffff02f6ae7d04000000001976a9144455183e407ee4d3423858c8a3275918aedcd18e88aca99b9b08010000001976a9140beceae2c29bfde08d2b6d80b33067451c5887be88ac00000000';
  var tx = Tx.fromRaw(txHex, 'hex');
  var txEncoded = Buffer.concat([new Buffer('00000002', 'hex'), new Buffer(blockHash, 'hex'), new Buffer('00000001', 'hex'), new Buffer('0002', 'hex'), new Buffer('40000000000000004008000000000000', 'hex'), tx.toRaw()]);
  var indexBuf = new Buffer(4);
  indexBuf.writeUInt32BE(3);

  it('should encode transaction key' , function() {
    var txBuf = new Buffer(txid, 'hex');
    encoding.encodeTransactionKey(txid).should.deep.equal(Buffer.concat([servicePrefix, new Buffer('00', 'hex'), txBuf]));
  });

  it('should decode transaction key', function() {
    encoding.decodeTransactionKey(Buffer.concat([servicePrefix, new Buffer('00', 'hex'), new Buffer(txid, 'hex')]))
    .should.equal(txid);
  });

  it('should encode transaction value', function() {
    tx.__height = 2;
    tx.__blockhash = blockHash;
    tx.__timestamp = 1;
    tx.__inputValues = [ 2, 3 ];

    encoding.encodeTransactionValue(tx).should.deep.equal(txEncoded);
  });

  it('should decode transaction value', function() {
    var tx = encoding.decodeTransactionValue(txEncoded);
    tx.__height.should.equal(2);

    tx.__timestamp.should.equal(1);
    tx.__inputValues.should.deep.equal([2,3]);
    tx.toRaw().toString('hex').should.equal(txHex);
  });

  it('should encode spent key', function() {
    encoding.encodeSpentKey(txid, 3).should.deep.equal(Buffer.concat([servicePrefix,
      new Buffer('01', 'hex'), new Buffer(txid, 'hex'), indexBuf]));
  });

  it('should decode spent key', function() {
    encoding.decodeSpentKey(Buffer.concat([servicePrefix,
      new Buffer('01', 'hex'), new Buffer(txid, 'hex'), indexBuf])).should.deep.equal({ txid: txid, outputIndex: 3 });
  });

  it('should encode spent value', function() {
    encoding.encodeSpentValue(txid, 3, 3, txid).should.deep.equal(Buffer.concat([new Buffer(txid, 'hex'), indexBuf, indexBuf, new Buffer(blockHash, 'hex')]));
  });

  it('should decode spent value', function() {
    encoding.decodeSpentValue(Buffer.concat([new Buffer(txid, 'hex'), indexBuf,
      indexBuf, new Buffer(blockHash, 'hex')]))
        .should.deep.equal({ txid: txid, inputIndex: 3, blockHeight: 3, blockHash: blockHash });
  });
});
