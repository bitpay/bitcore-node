'use strict';

var chai = require('chai');
var expect = chai.expect;
var async = require('async');
var BitcoinRPC = require('bitcoind-rpc');
var path = require('path');
var Utils = require('./utils');
var crypto = require('crypto');
var zmq = require('zmq');
var bitcore = require('bitcore-lib');
var Transaction = bitcore.Transaction;
var PrivateKey = bitcore.PrivateKey;
var Unit = bitcore.Unit;

var debug = false;
var extraDebug = true;
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
    listen: 1,
    regtest: 1,
    server: 1,
    listenonion: 0,
    whitelist: '127.0.0.1',
    rpcuser: rpcConfig.user,
    rpcpassword: rpcConfig.pass,
    rpcport: rpcConfig.port
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
      services: ['p2p', 'test-p2p'],
      servicesConfig: {
        p2p: {
          peers: [
            {
              ip: { v4: '127.0.0.1' }
            }
          ]
        },
        'test-p2p': {
          requirePath: path.resolve(__dirname + '/test_bus.js')
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

if (debug && extraDebug) {
  bitcoin.args.printtoconsole = 1,
  bitcoin.args.debug = 1,
  bitcoin.args.logips = 1
}

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

var subSocket;
var txs = [];
var blocks = [];

function processMessages(topic, message) {
  var topicStr = topic.toString();
  if (topicStr === 'transaction') {
    return txs.push(message);
  } else if (topicStr === 'block') {
    return blocks.push(message);
  }
}

function setupZmqSubscriber(callback) {

  subSocket = zmq.socket('sub');
  subSocket.on('connect', function(fd, endPoint) {
    if (debug) {
      console.log('ZMQ connected to:', endPoint);
    }
  });

  subSocket.on('disconnect', function(fd, endPoint) {
    if (debug) {
      console.log('ZMQ disconnect:', endPoint);
    }
  });

  subSocket.monitor(100, 0);
  subSocket.connect('tcp://127.0.0.1:38332');
  subSocket.subscribe('transaction');
  subSocket.subscribe('block');
  subSocket.on('message', processMessages);
  callback();
}

function waitForZmqConnection(callback) {
  async.retry({ interval: 500, times: 50 }, function(next) {
    return next(txs.length < utils.opts.initialTxs.length);
  }, callback);
}

describe('P2P Operations', function() {

  this.timeout(60000);

  after(function(done) {
    utils.cleanup(done);
  });

  before(function(done) {
    async.series([
      utils.startBitcoind.bind(utils),
      utils.waitForBitcoinReady.bind(utils)
    ], done);
  });

  it('should connect to the p2p network and stream the mempool to clients', function(done) {
    async.series([
      utils.unlockWallet.bind(utils),
      utils.setupInitialTxs.bind(utils),

      function(next) {
        async.eachSeries(utils.opts.initialTxs, function(tx, next) {
          utils.opts.rpc.sendRawTransaction(tx.serialize(), next);
        }, next);
      },

      utils.startBitcoreNode.bind(utils),
      setupZmqSubscriber,
      waitForZmqConnection

    ], function(err) {

      if(err) {
        return done(err);
      }

      var initialTxs = {};

      utils.opts.initialTxs.map(function(tx) {
        initialTxs[tx.hash] = true;
        return;
      });


      var i = 0;
      for(; i < utils.opts.initialTxs.length; i++) {
        var tx = new Transaction(txs[i]);
        expect(initialTxs[tx.hash]).to.equal(true);
      }

      expect(utils.opts.initialTxs.length).to.equal(i);
      done();
    });
  });

  it('should send new transactions as they are broadcasted by our trusted peer', function(done) {
    var tx;
    async.series([

      function(next) {
        opts.rpc.generate(10, next);
      },

      function(next) {
        utils.getPrivateKeysWithABalance(function(err, spendables) {

        if(err) {
          return next(err);
        }

        tx = new Transaction()
            .from(spendables[0].utxo)
            .to(new PrivateKey('testnet').toAddress().toString(),
              Unit.fromBTC(spendables[0].utxo.amount).satoshis - 100000)
            .fee(100000)
            .sign(spendables[0].privKey);

        utils.sendTx(tx, 0, next);
      });
    }
    ], function(err) {

      if(err) {
        return done(err);
      }

      setTimeout(function() {
        var broadcastedTx = new Transaction(txs[txs.length - 1]);
        expect(tx.hash).to.equal(broadcastedTx.hash);
        expect(txs.length).to.equal(utils.opts.initialTxs.length + 1);
        done();
      }, 1000);
    });

  });

  it('should get blocks from peer that we do not have on startup', function(done) {

    done();
  });

  it('should send new blocks as they are broadcasted by our trusted peer', function(done) {
    expect(blocks.length).to.equal(1);
    done();
  });



});

