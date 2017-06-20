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
var Block = bitcore.Block;
var BlockHeader = bitcore.BlockHeader;
var constants = require('../lib/constants');
var debug = true;
var extraDebug = true;
//advisable to use a tmpfs here, much easier on NAND-based disks and good for performance
var bitcoreDataDir = '/tmp/testtmpfs/bitcore';
// to do this on Linux: sudo mount -t tmpfs -o size=512m tmpfs /tmp/testtmpfs
var bitcoinDataDir = '/tmp/testtmpfs/bitcoin';

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
      services: ['p2p', 'test-p2p', 'web'],
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
  bitcoin.args.printtoconsole = 1;
  bitcoin.args.debug = 1;
  bitcoin.args.logips = 1;
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
  initialHeight: 110,
  path: '/test/info',
  errorFilter: function(err, res) {
    try {
      var info = JSON.parse(res);
      if (info.result) {
        return;
      }
    } catch(e) {
      return e;
    }
  }
};

var utils = new Utils(opts);

var subSocket;
var txs = [];
var blocks = [];
var headers = [];
var startingBlockHash;
var count = 0;
function processMessages(topic, message) {
  var topicStr = topic.toString();
  if (topicStr === 'transaction') {
    return txs.push(message);
  } else if (topicStr === 'block') {
    count++;
    return blocks.push(message);
  } else if (topicStr === 'headers') {
    return headers.push(message);
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
  subSocket.subscribe('headers');
  subSocket.on('message', processMessages);
  callback();
}

describe('P2P Operations', function() {

  this.timeout(60000);

  after(function(done) {
    utils.cleanup(done);
  });

  before(function(done) {
    async.series([
      utils.startBitcoind.bind(utils),
      utils.waitForBitcoinReady.bind(utils),
      utils.unlockWallet.bind(utils),
      utils.setupInitialTxs.bind(utils),
      utils.startBitcoreNode.bind(utils),
      utils.waitForBitcoreNode.bind(utils),
      setupZmqSubscriber,
      utils.sendTxs.bind(utils, false)
    ], done);
  });

  describe('Mempool', function() {
    it('should send new transactions as they are broadcasted by our trusted peer (unsoliticted)', function(done) {

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

      expect(txs.length).to.equal(i);
      done();

    });

    it('should connect to the p2p network and stream the mempool to clients', function(done) {
      // this tricky because if the p2p service has already asked for the data
      // from a particular peer, it will not ask again until the inv hash is dropped
      // from its lru cache. So, to fake this out, I will clear this cache manually
      txs.length = 0;
      utils.queryBitcoreNode(Object.assign({
        path: '/test/mempool',
      }, bitcore.httpOpts), function(err) {

        if(err) {
          return done(err);
        }

        setTimeout(function() {
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

          expect(txs.length).to.equal(i);

          done();
        }, 2000);
      });
    });

    it('should be able to set a mempool filter and only get back what is NOT in the filter', function(done) {
      var newTx = txs.shift();
      newTx = new Transaction(newTx);
      var argTxs = txs.map(function(rawTx) {
        var tx = new Transaction(rawTx);
        return tx.hash;
      });
      txs.length = 0;
      utils.queryBitcoreNode(Object.assign({
        path: '/test/mempool?filter=' + JSON.stringify(argTxs)
      }, bitcore.httpOpts), function(err) {

        if (err) {
          return done(err);
        }

        setTimeout(function() {

          var tx = new Transaction(txs[0]);
          expect(newTx.hash).to.equal(tx.hash);
          expect(txs.length).to.equal(1);
          done();
        }, 2000);
      });
    });
  });

  describe('Block', function() {

    it('should get blocks when they are relayed to us', function(done) {
      opts.rpc.generate(1, function(err, res) {
        if(err) {
          return done(err);
        }
        startingBlockHash = res.result[0];
        setTimeout(function() {
          expect(blocks.length).to.equal(1);
          var block = new Block(blocks[0]);
          expect(startingBlockHash).to.equal(block.hash);
          done();
        }, 2000);
      });
    });

    it('should be able to get historical blocks', function(done) {

      blocks.length = 0;
      var filter = { startHash: constants.BITCOIN_GENESIS_HASH.regtest };
      utils.queryBitcoreNode(Object.assign({
        path: '/test/blocks?filter=' + JSON.stringify(filter),
      }, bitcore.httpOpts), function(err) {

        if(err) {
          return done(err);
        }

        setTimeout(function() {
          expect(blocks.length).to.equal(utils.opts.blockHeight + 1);
          var lastBlock = new Block(blocks[blocks.length - 1]);
          expect(startingBlockHash).to.equal(lastBlock.hash);
          done();
        }, 2000);


      });

    });


  });

  describe('Block Headers', function() {

    it('should be able to get historical block headers', function(done) {

      var filter = { startHash: constants.BITCOIN_GENESIS_HASH.regtest };
      utils.queryBitcoreNode(Object.assign({
        path: '/test/headers?filter=' + JSON.stringify(filter),
      }, bitcore.httpOpts), function(err) {

        if(err) {
          return done(err);
        }

        setTimeout(function() {

          expect(headers.length).to.equal(utils.opts.blockHeight + 1);
          var lastBlockHeader = new BlockHeader(blocks[blocks.length - 1]);
          expect(startingBlockHash).to.equal(lastBlockHeader.hash);
          done();

        }, 2000);


      });
    });

    it('should return up to 2000 headers in a single call to getHeaders', function(done) {

      // p2p note: when asking for a series of headers, your peer will always follow up
      // with an additional inventory message after delivering the initial data.

      // after getHeaders: an inv message for the block matching the latest header you received.
      // remember: getHeaders message does not respond with an inventory message like getBlocks does,
      // instead it responds with the header message, but THEN will respond with a single inventory
      // message representing the block of the last header delievered.

      // For example: if there exists 4 blocks with block hashes a,b,c,d:
      // getHeaders({ starts: 'a', stop: 0 }) should receive headers for b,c,d and an inv message for block d.
      var additionalBlockCount = 2000 - 111;
      headers.length = 0;
      opts.rpc.generate(additionalBlockCount, function(err) {

        if(err) {
          return done(err);
        }

        var filter = { startHash: constants.BITCOIN_GENESIS_HASH.regtest };

        utils.queryBitcoreNode(Object.assign({
          path: '/test/headers?filter=' + JSON.stringify(filter),
        }, bitcore.httpOpts), function(err) {

          if(err) {
            return done(err);
          }

          setTimeout(function() {

            expect(headers.length).to.equal(2000);
            done();

          }, 2000);


        });

      });
    });

    it('should return up to 500 blocks in a single call to getBlocks', function(done) {

      // p2p note: when asking for a series of headers, your peer will always follow up
      // with an additional inventory message after delivering the initial data.

      // after getBlocks: an inv message for the block immediately following the last one you received, if
      // there more blocks to retrieve. Since there is a 500 block limit in the initial inventory message response,
      // when receiving 500 blocks, an additional inventory message will tell you what the next block is and that
      // are more blocks to be retrieved.

      blocks.length = 0;
      count = 0;
      var filter = { startHash: constants.BITCOIN_GENESIS_HASH.regtest };

      utils.queryBitcoreNode(Object.assign({
        path: '/test/blocks?filter=' + JSON.stringify(filter),
      }, bitcore.httpOpts), function(err) {

        if(err) {
          return done(err);
        }

        setTimeout(function() {

          expect(blocks.length).to.equal(501);
          done();

        }, 2000);

      });
    });

  });


});

