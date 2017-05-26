'use strict';

var chai = require('chai');
var expect = chai.expect;
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

describe('Utxo Operations', function() {

  this.timeout(60000);

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
      utils.sendTxs.bind(utils, self.opts),
      utils.startBitcoreNode.bind(utils, self.opts),
      utils.waitForBitcoreNode.bind(utils, self.opts)
    ], done);
  });

  it('should index utxos', function(done) {
    async.mapLimit(opts.walletPrivKeys, 12, function(privKey, next) {

      var address = privKey.toAddress().toString();
      utils.queryBitcoreNode(Object.assign({
        path: '/test/utxo/' + address
      }, bitcore.httpOpts), function(err, res) {

        if(err) {
          return next(err);
        }

        res = JSON.parse(res);
        expect(res.address).to.equal(address);
        expect(res.utxos.length).equal(1);
        expect(Object.keys(res.utxos[0])).to.deep.equal([ 'txid',  'outputIndex', 'address', 'height', 'satoshis', 'script' ]);
        next(null, res.utxos);
      });
    }, function(err, utxos) {

      if(err) {
        return done(err);
      }

      done();

    });
  });

});

