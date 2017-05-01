'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var DB = require('../../../lib/services/db');
var Networks = bitcore.Networks;
var EventEmitter = require('events').EventEmitter;
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var blocks = require('../../data/blocks.json');


describe('DB', function() {

  var bitcoind = {
    on: function(event, callback) {
    },
    genesisBuffer: blocks.genesis
  };

  var node = {
    network: Networks.testnet,
    datadir: '/tmp/datadir',
    services: { bitcoind: bitcoind },
    on: sinon.stub(),
    once: sinon.stub()
  };

  before(function(done) {

    var self = this;

    rimraf(node.datadir, function(err) {
      if(err) {
        return done(err);
      }
      mkdirp(node.datadir, done);
    });

    this.db = new DB({node: node});
    this.emitter = new EventEmitter();

  });


  describe('Reorg', function() {

    it('should start db service', function(done) {
      this.db.start(done);
    });

  });
});

