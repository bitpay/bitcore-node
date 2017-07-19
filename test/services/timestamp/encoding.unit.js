'use strict';
var should = require('chai').should();

var Encoding = require('../../../lib/services/timestamp/encoding');

describe('Timestamp service encoding', function() {

  var servicePrefix = new Buffer('0000', 'hex');
  var blockPrefix = new Buffer('00', 'hex');
  var timestampPrefix = new Buffer('01', 'hex');
  var encoding = new Encoding(servicePrefix);
  var blockhash = '00000000000000000115b92b1ff4377441049bff75c6c48b626eb99e8b744297';
  var timestamp = 5;
  var timestampBuf = new Buffer(4);
  timestampBuf.writeUInt32BE(timestamp);

  it('should encode block timestamp key' , function() {
    encoding.encodeBlockTimestampKey(blockhash).should.deep.equal(Buffer.concat([servicePrefix, blockPrefix, new Buffer(blockhash, 'hex')]));
  });

  it('should decode block timestamp key', function() {
    var blockTimestampKey = encoding.decodeBlockTimestampKey(Buffer.concat([servicePrefix, blockPrefix, new Buffer(blockhash, 'hex')]));
    blockTimestampKey.should.equal(blockhash);
  });

  it('should encode block timestamp value', function() {
    encoding.encodeBlockTimestampValue(timestamp).should.deep.equal(timestampBuf);
  });

  it('should decode block timestamp value', function() {
    encoding.decodeBlockTimestampValue(timestampBuf).should.equal(timestamp);
  });

  it('should encode timestamp block key', function() {
    encoding.encodeTimestampBlockKey(timestamp).should.deep.equal(Buffer.concat([servicePrefix, timestampPrefix, timestampBuf]));
  });

  it('should decode timestamp block key', function() {
    encoding.decodeTimestampBlockKey(Buffer.concat([servicePrefix, timestampPrefix, timestampBuf])).should.equal(timestamp);
  });

  it('should encode timestamp block value', function() {
    encoding.encodeTimestampBlockValue(blockhash).should.deep.equal(new Buffer(blockhash, 'hex'));
  });

  it('should decode timestamp block value', function() {
    encoding.decodeTimestampBlockValue(new Buffer(blockhash, 'hex')).should.equal(blockhash);
  });
});
