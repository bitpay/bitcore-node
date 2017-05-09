'use strict';

var chai = require('chai');
var should = chai.should();
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var path = require('path');
var utils = require('./utils');
var crypto = require('crypto');

var debug = true;
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

var opts = {
  debug: debug,
  bitcore: bitcore,
  bitcoin: bitcoin,
  bitcoinDataDir: bitcoinDataDir,
  bitcoreDataDir: bitcoreDataDir,
  rpc: new BitcoinRPC(rpcConfig),
  walletPassphrase: 'test',
  txCount: 0,
  blockHeight: 0,
  walletPrivKeys: [],
  initialTxs: [],
  fee: 100000,
  feesReceived: 0,
  satoshisSent: 0,
  walletId: crypto.createHash('sha256').update('test').digest('hex'),
  satoshisReceived: 0,
  initialHeight: 150
};

describe('Wallet Operations', function() {

  this.timeout(60000);

  describe('Register, Upload, GetTransactions', function() {

    var self = this;

    after(function(done) {
      utils.cleanup(self.opts, done);
    });

    before(function(done) {
      self.opts = Object.assign({}, opts);
      async.series([
        utils.startBitcoind.bind(utils, self.opts),
        utils.waitForBitcoinReady.bind(utils, self.opts),
        utils.unlockWallet.bind(utils, self.opts),
        utils.setupInitialTxs.bind(utils, self.opts),
        utils.startBitcoreNode.bind(utils, self.opts),
        utils.waitForBitcoreNode.bind(utils, self.opts)
      ], done);
    });

    it('should register wallet', function(done) {

      utils.registerWallet.call(utils, self.opts,  function(err, res) {

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

      utils.uploadWallet.call(utils, self.opts, done);

    });

    it('should get a list of transactions', function(done) {

      //the wallet should be fully uploaded and indexed by the time this happens
      utils.sendTxs.call(utils, self.opts, function(err) {

        if(err) {
          return done(err);
        }
        utils.waitForBitcoreNode.call(utils, self.opts, function(err) {

          if(err) {
            return done(err);
          }
          utils.getListOfTxs.call(utils, self.opts, done);
        });
      });

    });

  });

  describe('Load addresses after syncing the blockchain', function() {

    var self = this;

    self.opts = Object.assign({}, opts);

    after(utils.cleanup.bind(utils, self.opts));

    before(function(done) {
      async.series([
        utils.startBitcoind.bind(utils, self.opts),
        utils.waitForBitcoinReady.bind(utils, self.opts),
        utils.unlockWallet.bind(utils, self.opts),
        utils.setupInitialTxs.bind(utils, self.opts),
        utils.sendTxs.bind(utils, self.opts),
        utils.startBitcoreNode.bind(utils, self.opts),
        utils.waitForBitcoreNode.bind(utils, self.opts),
        utils.registerWallet.bind(utils, self.opts),
        utils.uploadWallet.bind(utils, self.opts)
      ], done);
    });

    it('should get list of transactions', function(done) {

      utils.getListOfTxs.call(utils, self.opts, done);

    });

    it('should get the balance of a wallet', function(done) {

      var httpOpts = utils.getHttpOpts.call(
        utils,
        self.opts,
        { path: '/wallet-api/wallets/' + self.opts.walletId + '/balance' });

      utils.queryBitcoreNode.call(utils, httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        results.satoshis.should.equal(self.opts.satoshisReceived);
        done();
      });

    });

    it('should get the set of utxos for the wallet', function(done) {

      var httpOpts = utils.getHttpOpts.call(
        utils,
        self.opts,
        { path: '/wallet-api/wallets/' + opts.walletId + '/utxos' });

      utils.queryBitcoreNode.call(utils, httpOpts, function(err, res) {

        if(err) {
          return done(err);
        }

        var results = JSON.parse(res);
        var balance = 0;

        results.utxos.forEach(function(utxo) {
          balance += utxo.satoshis;
        });

        results.height.should.equal(self.opts.blockHeight);
        balance.should.equal(self.opts.satoshisReceived);
        done();
      });
    });

    it('should get the list of jobs', function(done) {
      var httpOpts = utils.getHttpOpts.call(utils, self.opts, { path: '/wallet-api/jobs' });
      utils.queryBitcoreNode.call(utils, httpOpts, function(err, res) {
        if(err) {
          return done(err);
        }
        var results = JSON.parse(res);
        results.jobCount.should.equal(1);
        done();
      });
    });

    it('should remove all wallets', function(done) {
      var httpOpts = utils.getHttpOpts.call(utils, self.opts, { path: '/wallet-api/wallets', method: 'DELETE' });
      utils.queryBitcoreNode.call(utils, httpOpts, function(err, res) {
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
