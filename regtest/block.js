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
        'web',
        'block',
        'timestamp',
        'block-test'
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
        'block-test': {
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

    it('should sync block hashes as keys and heights as values', function(done) {

      async.timesLimit(opts.initialHeight, 12, function(n, next) {
        utils.queryBitcoreNode(Object.assign({
          path: '/test/block/hash/' + n
        }, bitcore.httpOpts), function(err, res) {

          if(err) {
            return done(err);
          }
          res = JSON.parse(res);
          expect(res.height).to.equal(n);
          expect(res.hash.length).to.equal(64);
          next(null, res.hash);
        });
      }, function(err, hashes) {

        if(err) {
          return done(err);
        }
        self.hashes = hashes;
        done();

      });
    });

    it('should sync block heights as keys and hashes as values', function(done) {
      async.timesLimit(opts.initialHeight, 12, function(n, next) {
        utils.queryBitcoreNode(Object.assign({
          path: '/test/block/height/' + self.hashes[n]
        }, bitcore.httpOpts), function(err, res) {

          if(err) {
            return done(err);
          }
          res = JSON.parse(res);
          expect(res.height).to.equal(n);
          expect(res.hash).to.equal(self.hashes[n]);
          next();
        });
      }, function(err) {

        if(err) {
          return done(err);
        }
        done();

      });

    });
  });

});
