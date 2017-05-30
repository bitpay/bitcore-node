'use strict';

var chai = require('chai');
var expect = chai.expect;
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var path = require('path');
var Utils = require('./utils');
var crypto = require('crypto');
var bitcore = require('bitcore-lib');
var PrivateKey = bitcore.PrivateKey;
var Transaction = bitcore.Transaction;
var Output = bitcore.Transaction.Output;
var Script = bitcore.Script;
var _ = require('lodash');

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
    zmqpubrawblock: 'tcp://127.0.0.1:38332'
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
        'timestamp',
        'web',
        'block',
        'utxo',
        'utxo-test'
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
        },
        'utxo-test': {
          requirePath: path.resolve(__dirname + '/test_web.js')
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

var utils = new Utils(opts);

describe('Utxo Operations', function() {

  this.timeout(60000);

  var self = this;


  after(function(done) {
    utils.cleanup(done);
  });

  before(function(done) {
    async.series([
      utils.startBitcoind.bind(utils),
      utils.waitForBitcoinReady.bind(utils),
      utils.unlockWallet.bind(utils),
      utils.setupInitialTxs.bind(utils),
      utils.sendTxs.bind(utils),
      utils.startBitcoreNode.bind(utils),
      utils.waitForBitcoreNode.bind(utils)
    ], done);
  });

  it('should index utxos', function(done) {
    async.mapSeries(opts.walletPrivKeys, function(privKey, next) {

      var address = privKey.toAddress().toString();

      var httpOpts = Object.assign({
        path: '/test/utxo/' + address
      }, bitcore.httpOpts);

      utils.queryBitcoreNode(httpOpts, function(err, res) {

        if(err) {
          return next(err);
        }

        res = JSON.parse(res);
        expect(res.utxos.length).equal(1);
        expect(res.utxos[0].address).to.equal(address);
        expect(Object.keys(res.utxos[0])).to.deep.equal([
          'address',
          'txId',
          'outputIndex',
          'height',
          'satoshis',
          'script' ]);
        next(null, res.utxos);

      });
    }, function(err, results) {

      if(err) {
        return done(err);
      }

      self.utxos = _.flatten(results);

      done();

    });
  });

  it('should store p2pk and p2pkh utxos', function(done) {

    var pk1 = new PrivateKey('testnet');
    var pk2 = new PrivateKey('testnet');

    var satoshis = 100000000;
    var utxo = self.utxos[0];

    var tx = new Transaction();

    tx.from(utxo);

    tx.addOutput(new Output({
      satoshis: satoshis,
      script: Script.buildPublicKeyOut(pk1.publicKey)
    }));

    tx.change(pk2.toAddress().toString());
    tx.sign(opts.walletPrivKeys[0]);

    async.series([

      function(next) {
        utils.sendTx(tx, 1, function(err) {

          if (err) {
            return next(err);
          }

          next();
        });
      },

      function(next) {

        utils.waitForBitcoreNode(function(err) {

          if (err) {
            return next(err);
          }

          next();

        });

      },

      function(next) {

        var address = pk1.publicKey.toString('hex');
        var httpOpts = Object.assign({
          path: '/test/utxo/' + address
        }, bitcore.httpOpts);

        utils.queryBitcoreNode(httpOpts, function(err, res) {

          if(err) {
            return next(err);
          }

          res = JSON.parse(res);
          expect(res.utxos.length).to.equal(1);
          expect(res.utxos[0].address).to.equal(address);
          expect(res.utxos[0].satoshis).to.equal(satoshis);
          expect(Object.keys(res.utxos[0])).to.deep.equal([
            'address',
            'txId',
            'outputIndex',
            'height',
            'satoshis',
            'script' ]);

          next();

        });
      }

    ], function(err) {

      if(err) {
        return done(err);
      }


      done();

    });

  });

});

