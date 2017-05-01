'use strict';

var chai = require('chai');
var should = chai.should();
var async = require('async');
var path = require('path');
var utils = require('./utils');
var zmq = require('zmq');
var http = require('http');
var blocks = require('../test/data/blocks.json');
var bitcore = require('bitcore-lib');
var Block = bitcore.Block;
var BufferUtil = bitcore.util.buffer;

/*
   Bitcoind does not need to be started or run
*/

var debug = false;
var bitcoreDataDir = '/tmp/bitcore';
var pubSocket;
var rpcServer;

function setupFakeRpcServer() {
  rpcServer = http.createServer();
  rpcServer.listen(48332, '127.0.0.1');
}

function setupFakeZmq() {
  pubSocket = zmq.socket('pub');
  pubSocket.bind('tcp://127.0.0.1:38332');
}

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
              rpcconnect: '127.0.0.1',
              rpcport: 48332,
              rpcuser: 'bitcoin',
              rpcpassword: 'local321',
              zmqpubrawtx: 'tcp://127.0.0.1:38332'
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
  bitcoreDataDir: bitcoreDataDir,
  blockHeight: 0
};

var genesis = new Block(new Buffer(blocks.genesis, 'hex'));
var block1 = new Block(new Buffer(blocks.block1a, 'hex'));
var block2 = new Block(new Buffer(blocks.block1b, 'hex'));

describe('DB Operations', function() {

  this.timeout(60000);

  describe('DB Reorg', function() {

    var self = this;

    var responses = [
      genesis.hash,
      { hash: genesis.hash, height: 0 },
      genesis.hash,
      blocks.genesis, //end initChain
      block1.hash,
      blocks.block1a,
      block2.hash,
      blocks.block1b,
      { hash: block1.header.hash, previousblockhash: BufferUtil.reverse(block1.header.prevHash).toString('hex') },
      { hash: block2.header.hash, previousblockhash: BufferUtil.reverse(block2.header.prevHash).toString('hex') },
      blocks.genesis,
      blocks.block1b,
    ];

    after(function(done) {
      pubSocket.close();
      rpcServer.close();
      bitcore.process.kill();
      setTimeout(done, 1000);
    });


    before(function(done) {

      var responseCount = 0;

      setupFakeRpcServer();

      rpcServer.on('request', function(req, res) {
        var data = '';

        req.on('data', function(chunk) {
          data += chunk.toString();
        });

        req.on('end', function() {
          var body = JSON.parse(data);
          //console.log('request', body);
          var response = JSON.stringify({ result: responses[responseCount++] });
          //console.log('response', response, 'id: ', body.id);
          res.write(response);
          res.end();
        });

      });

      setupFakeZmq();

      self.opts = Object.assign({}, opts);

      utils.startBitcoreNode(self.opts, function() {
        utils.waitForBitcoreNode(self.opts, done);
      });

    });

    it('should reorg when needed', function(done) {

      var block1a = '77d0b8043d3a1353ffd22ad70e228e30c15fd0f250d51d608b1b7997e6239ffb';
      var block1b = '2e516187b1b58467cb138bf68ff00d9bda71b5487cdd7b9b9cfbe7b153cd59d4';

      /*
        _______________________________________________________
       |             |              |             |            |
       |  Genesis    |   Block 1a   |   Block 1b  |   Result   |
       |   _______       ________                              |
       |  |       |_____|        |___________________ORPHANED  |
       |  |_______|     |________|                             |
       |       |                       ________      ________  |
       |       |______________________|        |____|        | |
       |                              |________|    |________| |
       |_______________________________________________________|

      */

      async.series([

        publishBlockHash.bind(self, block1a),
        publishBlockHash.bind(self, block1b)

      ], function(err) {

        if(err) {
          return done(err);
        }
        done();

      });
    });
  });

});

function publishBlockHash(blockHash, callback) {

  pubSocket.send([ 'hashblock', new Buffer(blockHash, 'hex') ]);

  var httpOpts = utils.getHttpOpts(opts, { path: '/wallet-api/info' });

  //we don't know exactly when all the blockhandlers will complete after the "tip" event
  //so we must wait an indeterminate time to check on the current tip
  setTimeout(function() {

    utils.queryBitcoreNode(httpOpts, function(err, res) {

      if(err) {
        return callback(err);
      }

      blockHash.should.equal(JSON.parse(res).hash);
      callback();

    });

  }, 2000);
}


