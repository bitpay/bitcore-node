'use strict';

var benchmark = require('benchmark');
var async = require('async');
var sinon = require('sinon');
var bitcore = require('bitcore');
var Block = bitcore.Block;
var AddressService = require('../lib/services/address');
var maxTime = 20;

var blockData1 = require('./data/block-367238.json');
var blockData2 = require('./data/block-367239.json');
var blockData3 = require('./data/block-367240.json');

console.log('Address Service Block Handler');
console.log('-----------------------------');

async.series([
  function(next) {

    var c = 0;
    var blocks = [
      Block.fromBuffer(new Buffer(blockData1, 'hex')),
      Block.fromBuffer(new Buffer(blockData2, 'hex')),
      Block.fromBuffer(new Buffer(blockData3, 'hex'))
    ];
    var blocksLength = 3;
    var node = {
      services: {
        bitcoind : {
          on: sinon.stub()
        }
      }
    };
    var addressService = new AddressService({node: node});

    function blockHandler(deffered) {
      if (c >= blocksLength) {
        c = 0;
      }
      var block = blocks[c];
      addressService.blockHandler(block, true, function(err, operations) {
        if (err) {
          throw err;
        }
        deffered.resolve();
      });
      c++;
    }

    var suite = new benchmark.Suite();

    suite.add('blockHandler', blockHandler, {
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
  if (err) {
    throw err;
  }
  console.log('Finished');
  process.exit();
});
