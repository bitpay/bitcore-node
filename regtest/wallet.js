'use strict';

var chai = require('chai');
var should = chai.should();
var async = require('async');
var bitcore = require('bitcore-lib');
var BitcoinRPC = require('bitcoind-rpc');
var path = require('path');
var utils = require('utils');

var debug = false;
var bitcoreDataDir = '/tmp/bitcore';
var bitcoinDataDir = '/tmp/bitcoin';

var rpcConfig = {
  protocol: 'http',
  user: 'bitcoin',
  pass: 'local321',
  host: '127.0.0.1',
  port: '58332',
  rejectUnauthorized: false
};

var bitcoin = {
  args: {
    datadir: bitcoinDataDir,
    listen: 0,
    regtest: 1,
    server: 1,
    rpcuser: rpcConfig.user,
    rpcpassword: rpcConfig.pass,
    rpcport: rpcConfig.port,
    zmqpubrawtx: 'tcp://127.0.0.1:38332',
    zmqpubhashblock: 'tcp://127.0.0.1:38332'
  },
  datadir: bitcoinDataDir,
  exec: 'bitcoind', //if this isn't on your PATH, then provide the absolute path, e.g. /usr/local/bin/bitcoind
  process: null
};

var bitcore = {
  configFile: {
    file: bitcoreDataDir + '/bitcore-node.json',
    conf: {
      network: 'regtest',
      port: 53001,
      datadir: bitcoreDataDir,
      services: [
        'bitcoind',
        'db',
        'transaction',
        'timestamp',
        'address',
        'mempool',
        'wallet-api',
        'web'
      ],
      servicesConfig: {
        bitcoind: {
          connect: [
            {
              rpcconnect: rpcConfig.host,
              rpcport: rpcConfig.port,
              rpcuser: rpcConfig.user,
              rpcpassword: rpcConfig.pass,
              zmqpubrawtx: bitcoin.args.zmqpubrawtx
            }
          ]
        }
      }
    }
  },
  httpOpts: {
    protocol: 'http:',
    hostname: 'localhost',
    port: 53001,
  },
  opts: { cwd: bitcoreDataDir },
  datadir: bitcoreDataDir,
  exec: path.resolve(__dirname, '../bin/bitcore-node'),
  args: ['start'],
  process: null
};

var rpc = new BitcoinRPC(rpcConfig);
var walletPassphrase, txCount, blockHeight, walletPrivKeys,
initialTxs, fee, walletId, satoshisReceived, satoshisSent, feesReceived;
var initialHeight = 150;

describe('Wallet Operations', function() {

  this.timeout(60000);

  after(cleanup);

  describe('Register and Upload', function() {

    before(function(done) {
      initGlobals();
      async.series([
        startBitcoind,
        waitForBitcoinReady,
        unlockWallet,
        setupInitialTxs,
        startBitcoreNode,
        waitForBitcoreNode
      ], done);
    });

    it('should register wallet', function(done) {
      registerWallet(function(err, res) {
        if (err) {
          return done(err);
        }
        res.should.deep.equal(JSON.stringify({
          walletId: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
        }));
        done();
      });
    });

    it('should upload a wallet', function(done) {
      uploadWallet(done);
    });

  });

  describe('Load addresses at genesis block', function() {

    before(function(done) {
      sendTxs(function(err) {
        if(err) {
          return done(err);
        }
        waitForBitcoreNode(done);
      });
    });

    it('should get a list of transactions', function(done) {

      getListOfTxs(done);

    });

  });

  describe('Load addresses after syncing the blockchain', function() {

    before(function(done) {
      initGlobals();
      async.series([
        cleanup,
        startBitcoind,
        waitForBitcoinReady,
        unlockWallet,
        setupInitialTxs,
        sendTxs,
        startBitcoreNode,
        waitForBitcoreNode,
        registerWallet,
        uploadWallet
      ], done);
    });

    it('should get list of transactions', function(done) {

      getListOfTxs(done);

    });

    it('should get the balance of a wallet', function(done) {
      var httpOpts = getHttpOpts({ path: '/wallet-api/wallets/' + walletId + '/balance' });
      queryBitcoreNode(httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        results.satoshis.should.equal(satoshisReceived);
        done();
      });

    });

    it('should get the set of utxos for the wallet', function(done) {
      var httpOpts = getHttpOpts({ path: '/wallet-api/wallets/' + walletId + '/utxos' });
      queryBitcoreNode(httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        var balance = 0;

        results.utxos.forEach(function(utxo) {
          balance += utxo.satoshis;
        });
        results.height.should.equal(blockHeight);
        balance.should.equal(satoshisReceived);
        done();
      });
    });

    it('should get the list of jobs', function(done) {
      var httpOpts = getHttpOpts({ path: '/wallet-api/jobs' });
      queryBitcoreNode(httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        results.jobCount.should.equal(1);
        done();
      });
    });

    it('should remove all wallets', function(done) {
      var httpOpts = getHttpOpts({ path: '/wallet-api/wallets', method: 'DELETE' });
      queryBitcoreNode(httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        results.numberRemoved.should.equal(152);
        done();
      });
    });
  });
});
