'use strict';

var chai = require('chai');
var expect = chai.expect;
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var path = require('path');
var utils = require('./utils');

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
        'block',
        'web',
        'block.regtest',
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
  blockHeight: 0,
  initialHeight: 150
};

describe('Block Operations', function() {

  this.timeout(60000);

  describe('Sync Block Headers', function() {

    var self = this;

    after(function(done) {
      utils.cleanup(self.opts, done);
    });

    before(function(done) {
      self.opts = Object.assign({}, opts);
      async.series([
        utils.startBitcoind.bind(utils, self.opts),
        utils.waitForBitcoinReady.bind(utils, self.opts),
        utils.startBitcoreNode.bind(utils, self.opts),
        utils.waitForBitcoreNode.bind(utils, self.opts)
      ], done);
    });

    it('should sync block headers', function(done) {
      done();
    });
  });

});
