'use strict'

var assert = require('assert');
var benchmark = require('benchmark');
var bitcoinconsensus = require('../');
var bitcoin = require('bitcoin');
var async = require('async');

var maxTime = 10;

console.log('Benchmarking Bitcoind.js native interface versus Bitcoind JSON RPC interface');
console.log('----------------------------------------------------------------------');
// The primary methods needed are:

// getInfo  === works
// getRawTransactioni === getrawtransaction "txid" ( verbose )
// sendRawTransaction === sendrawtransaction "hexstring" ( allowhighfees )
// getTransaction === either I need txindex turned on -or- the wallet turned on
// Wallet functionality isn't needed, and libbitcoind.so could be compiled with the --disable-wallet flag.
var fixtureData = {

  transactions: [
    '5523b432c1bd6c101bee704ad6c560fd09aefc483f8a4998df6741feaa74e6eb',
    'ff48393e7731507c789cfa9cbfae045b10e023ce34ace699a63cdad88c8b43f8',
    '5d35c5eebf704877badd0a131b0a86588041997d40dbee8ccff21ca5b7e5e333',
    '88842f2cf9d8659c3434f6bc0c515e22d87f33e864e504d2d7117163a572a3aa',
  ]
}

var bitcoind = require('../')({
  directory: '~/.libbitcoind-example'
});

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);
  var client = new bitcoin.Client({
    host: 'localhost',
    port: 18332,
    user: 'bitpaytest',
    pass: 'local321'
  });

  async.series([
    function(next) {

      function bitcoindJsonRpc() {

         client.getInfo();
//        var item = Math.floor((Math.random() * fixtures.length));
//        var data = fixtureData.transactions[item];
//
//        client.getTransaction(data, function(err, tx) {
//          assert.equal(err, null);
//        });
      }

      function bitcoindNative() {

        bitcoind.getInfo();
//        var item = Math.floor((Math.random() * fixtures.length));
//        var data = fixtureData.transaction[item];
//
//        bitcoind.getTransaction(data, function(err, tx) {
//          assert.equal(err, null);
//        });
      }

      var suite = new benchmark.Suite();

      suite.add('bitcoind json rpc', bitcoindJsonRpc, { maxTime: maxTime });
      suite.add('bitcoind native', bitcoindNative, { maxTime: maxTime });

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
