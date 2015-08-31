'use strict';

var should = require('chai').should();
var proxyquire = require('proxyquire');
var fs = require('fs');
var sinon = require('sinon');
var BitcoinModule = proxyquire('../../lib/modules/bitcoind', {
  fs: {
    readFileSync: sinon.stub().returns(fs.readFileSync(__dirname + '/../data/bitcoin.conf'))
  }
});
var BadBitcoin = proxyquire('../../lib/modules/bitcoind', {
  fs: {
    readFileSync: sinon.stub().returns(fs.readFileSync(__dirname + '/../data/badbitcoin.conf'))
  }
});

describe('Bitcoin Module', function() {
  var baseConfig = {
    node: {
      datadir: 'testdir',
      network: {
        name: 'regtest'
      }
    }
  };
  describe('#_loadConfiguration', function() {
    it('will parse a bitcoin.conf file', function() {
      var bitcoind = new BitcoinModule(baseConfig);
      bitcoind._loadConfiguration({datadir: process.env.HOME + '/.bitcoin'});
      should.exist(bitcoind.configuration);
      bitcoind.configuration.should.deep.equal({
        server: 1,
        whitelist: '127.0.0.1',
        txindex: 1,
        port: 20000,
        rpcallowip: '127.0.0.1',
        rpcuser: 'bitcoin',
        rpcpassword: 'local321'
      });
    });
    it('should throw an exception if txindex isn\'t enabled in the configuration', function() {
      var bitcoind = new BadBitcoin(baseConfig);
      (function() {
        bitcoind._loadConfiguration({datadir: './test'});
      }).should.throw('Txindex option');
    });
  });
});

