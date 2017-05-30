'use strict';

var chai = require('chai');
var expect = chai.expect;
var async = require('async');
var path = require('path');
var Utils = require('./utils');
var zmq = require('zmq');
var http = require('http');
var blocks = require('../test/data/blocks.json');
var bitcore = require('bitcore-lib');
var Block = bitcore.Block;
var BufferUtil = bitcore.util.buffer;

/*
   Bitcoind does not need to be started or run
*/

var debug = true;
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
        'web',
        'block',
        'reorg-test',
        'timestamp'
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
        },
        'reorg-test': { requirePath: path.resolve(__dirname + '/test_web.js') }
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
var utils = new Utils(opts);

var genesis = new Block(new Buffer(blocks.genesis, 'hex'));
var block1 = new Block(new Buffer(blocks.block1a, 'hex'));
var block2 = new Block(new Buffer(blocks.block1b, 'hex'));
var rawGenesis = blocks.genesis;
var rawBlock1 = blocks.block1a;
var rawBlock2 = blocks.block1b;
var genesisHash = genesis.hash;
var genesisHeader = {
  height: 0,
  hash: genesis.hash,
  previousblockhash: new Array(65).join('0')
};
var block1Header = {
  height: 1,
  hash: block1.header.hash,
  previousblockhash: BufferUtil.reverse(block1.header.prevHash).toString('hex')
};
var block2Header = {
  height: 1,
  hash: block2.header.hash,
  previousblockhash: BufferUtil.reverse(block2.header.prevHash).toString('hex')
};


function publishBlockHash(rawBlockHex, callback) {

  pubSocket.send([ 'rawblock', new Buffer(rawBlockHex, 'hex') ]);

  var httpOpts = utils.getHttpOpts({ path: '/info' });

  // we don't know exactly when all the blockhandlers will complete after the "tip" event
  // so we must wait an indeterminate time to check on the current tip
  setTimeout(function() {

    utils.queryBitcoreNode(httpOpts, function(err, res) {

      if(err) {
        return callback(err);
      }

      var block = Block.fromString(rawBlockHex);
      expect(block.hash).equal(JSON.parse(res).dbhash);
      callback();

    });

  }, 2000);
}

describe('DB Operations', function() {

  this.timeout(60000);

  describe('DB Reorg', function() {

    var self = this;

    var responses = [
      genesisHash,
      genesisHeader,
      rawGenesis,
      block1Header,
      block2Header
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
          if (debug) {
            console.log('request', body);
          }
          var response = JSON.stringify({ result: responses[responseCount++], count: responseCount });
          if (debug) {
            console.log('response', response, 'id: ', body.id);
          }
          res.write(response);
          res.end();
        });

      });

      setupFakeZmq();

      utils.startBitcoreNode(function() {
        utils.waitForBitcoreNode(done);
      });

    });

    it('should reorg when needed', function(done) {

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

        publishBlockHash.bind(self, rawBlock1),
        publishBlockHash.bind(self, rawBlock2),
        function(next) {
          utils.opts.blockHeight++;
          next();
        },
        utils.waitForBitcoreNode.bind(utils)

      ], done);

    });
  });

});



