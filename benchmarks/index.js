'use strict';

var benchmark = require('benchmark');
var bitcoin = require('bitcoin');
var async = require('async');
var maxTime = 20;

console.log('Benchmarking Bitcoind.js native interface versus Bitcoind JSON RPC interface');
console.log('----------------------------------------------------------------------');

// To run the benchmarks a fully synced Bitcore Core directory is needed. The RPC comands
// can be modified to match the settings in bitcoin.conf.

// The primary methods that are needed:
// getInfo === works
// getRawTransaction === getrawtransaction "txid" ( verbose )
// sendRawTransaction === sendrawtransaction "hexstring" ( allowhighfees )
// getTransaction === either I need txindex turned on -or- the wallet turned on
// Wallet functionality isn't needed, and libbitcoind.so could be compiled with the --disable-wallet flag.

var blockHashes = [
  '00000000fa7a4acea40e5d0591d64faf48fd862fa3561d111d967fc3a6a94177',
  '000000000017e9e0afc4bc55339f60ffffb9cbe883f7348a9fbc198a486d5488',
  '000000000019ddb889b534c5d85fca2c91a73feef6fd775cd228dea45353bae1',
  '0000000000977ac3d9f5261efc88a3c2d25af92a91350750d00ad67744fa8d03'
];

var fixtureData = {
  transactions: [
    '5523b432c1bd6c101bee704ad6c560fd09aefc483f8a4998df6741feaa74e6eb',
    'ff48393e7731507c789cfa9cbfae045b10e023ce34ace699a63cdad88c8b43f8',
    '5d35c5eebf704877badd0a131b0a86588041997d40dbee8ccff21ca5b7e5e333',
    '88842f2cf9d8659c3434f6bc0c515e22d87f33e864e504d2d7117163a572a3aa',
  ]
};

var bitcoind = require('../')({
  directory: '~/.bitcoin',
  testnet: true
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
});

bitcoind.on('ready', function() {

  bitcoind.log('status="%s"', 'chaintip ready.');

  var client = new bitcoin.Client({
    host: 'localhost',
    port: 18332,
    user: 'bitcoin',
    pass: 'local321'
  });

  async.series([
    function(next) {

      var c = 0;
      var hashesLength = blockHashes.length;

      function bitcoindGetBlockNative(deffered) {
        if (c >= hashesLength) {
          c = 0;
        }
        var hash = blockHashes[c];
        bitcoind.getBlock(hash, function(err, block) {
          if (err) {
            throw err;
          }
          deffered.resolve();
        });
        c++;
      }

      function bitcoindGetBlockJsonRpc(deffered) {
        if (c >= hashesLength) {
          c = 0;
        }
        var hash = blockHashes[c];
        client.getBlock(hash, false, function(err, block) {
          if (err) {
            throw err;
          }
          deffered.resolve();
        });
        c++;
      }

      var suite = new benchmark.Suite();

      suite.add('bitcoind getblock (native)', bitcoindGetBlockNative, {
        defer: true,
        maxTime: maxTime
      });

      suite.add('bitcoind getblock (json rpc)', bitcoindGetBlockJsonRpc, {
        defer: true,
        maxTime: maxTime
      });

      suite
        .on('cycle', function(event) {
          console.log(String(event.target));
        })
        .on('complete', function() {
          console.log('Fastest is ' + this.filter('fastest').pluck('name'));
          console.log('----------------------------------------------------------------------');
          next();
        })
        .run();
    }
  ], function(err) {
    console.log('Finished');
    bitcoind.stop();
    process.exit();
  });
});
