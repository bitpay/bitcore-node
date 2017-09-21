'use strict';

var BaseService = require('../../service');
var inherits = require('util').inherits;
var Encoding = require('./encoding');
var index = require('../../');
var log = index.log;
var utils = require('../../utils');
var async = require('async');
var BN = require('bn.js');
var consensus = require('bcoin').consensus;
var assert = require('assert');
var constants = require('../../constants');
var bcoin = require('bcoin');

var HeaderService = function(options) {

  BaseService.call(this, options);

  this._tip = null;
  this._p2p = this.node.services.p2p;
  this._db = this.node.services.db;
  this._hashes = [];

  this.subscriptions = {};
  this.subscriptions.block = [];
  this._checkpoint = options.checkpoint || 2000; // set to -1 to resync all headers.
  this.GENESIS_HASH = constants.BITCOIN_GENESIS_HASH[this.node.network];
  this._lastHeader = null;
  this.lastBlockQueried = null;
  this._initialSync = true;
};

inherits(HeaderService, BaseService);

HeaderService.dependencies = [ 'p2p', 'db' ];

HeaderService.MAX_CHAINWORK = new BN(1).ushln(256);
HeaderService.STARTING_CHAINWORK = '0000000000000000000000000000000000000000000000000000000100010001';

// --- public prototype functions
HeaderService.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
  log.info(emitter.remoteAddress, 'subscribe:', 'header/' + name, 'total:', this.subscriptions[name].length);
};

HeaderService.prototype.unsubscribe = function(name, emitter) {

  var index = this.subscriptions[name].indexOf(emitter);

  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }

  log.info(emitter.remoteAddress, 'unsubscribe:', 'header/' + name, 'total:', this.subscriptions[name].length);

};

HeaderService.prototype.getAPIMethods = function() {

  var methods = [
    ['getAllHeaders', this, this.getAllHeaders, 0],
    ['getBestHeight', this, this.getBestHeight, 0],
    ['getBlockHeader', this, this.getBlockHeader, 1]
  ];

  return methods;

};

HeaderService.prototype.getCurrentDifficulty = function() {
  var target = bcoin.mining.common.getTarget(this._lastHeader.bits);
  return bcoin.mining.common.getDifficulty(target);
};

HeaderService.prototype.getAllHeaders = function(callback) {

  var self = this;
  var start = self._encoding.encodeHeaderHeightKey(0);
  var end = self._encoding.encodeHeaderHeightKey(self._tip.height + 1);
  var allHeaders = new utils.SimpleMap();

  var criteria = {
    gte: start,
    lt: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;

  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    var header = self._encoding.decodeHeaderValue(data.value);
    allHeaders.set(header.hash, header, header.height);
  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    callback(null, allHeaders);

  });
};

HeaderService.prototype.getBlockHeader = function(arg, callback) {

  if (utils.isHeight(arg)) {
    return this._getHeader(arg, null, callback);
  }

  return this._getHeader(null, arg, callback);

};

HeaderService.prototype.getBestHeight = function() {
  return this._tip.height;
};

HeaderService.prototype._adjustTip = function() {

  if (this._checkpoint === -1 || this._tip.height < this._checkpoint) {

    this._tip.height = 0;
    this._tip.hash = this.GENESIS_HASH;

  } else {

    this._tip.height -= this._checkpoint;

  }

};

HeaderService.prototype._setGenesisBlock = function(callback) {

  assert(this._tip.hash === this.GENESIS_HASH, 'Expected tip hash to be genesis hash, but it was not.');

  var genesisHeader = {
    hash: this.GENESIS_HASH,
    height: 0,
    chainwork: HeaderService.STARTING_CHAINWORK,
    version: 1,
    prevHash: new Array(65).join('0'),
    timestamp: 1231006505,
    nonce: 2083236893,
    bits: 0x1d00ffff,
    merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'
  };

  this._lastHeader = genesisHeader;

  var dbOps = [
    {
      type: 'put',
      key: this._encoding.encodeHeaderHeightKey(0),
      value: this._encoding.encodeHeaderValue(genesisHeader)
    },
    {
      type: 'put',
      key: this._encoding.encodeHeaderHashKey(this.GENESIS_HASH),
      value: this._encoding.encodeHeaderValue(genesisHeader)
    }
  ];

  this._db.batch(dbOps, callback);

};

HeaderService.prototype.start = function(callback) {

  var self = this;

  async.waterfall([
    function(next) {
      self._db.getPrefix(self.name, next);
    },
    function(prefix, next) {
      self._encoding = new Encoding(prefix);
      self._db.getServiceTip(self.name, next);
    },
    function(tip, next) {

      self._tip = tip;

      self._adjustTip();

      if (self._tip.height === 0) {
        return self._setGenesisBlock(next);
      }

      self._getLastHeader(next);

    },
  ], function(err) {

      if (err) {
        return callback(err);
      }

      // set block worker queue, concurrency 1
      self._blockProcessor = async.queue(self._processBlocks.bind(self));

      self._setListeners();
      self._bus = self.node.openBus({remoteAddress: 'localhost-header'});
      self._startHeaderSubscription();

      callback();

  });

};

HeaderService.prototype.stop = function(callback) {

  if (this._headerInterval) {
    clearInterval(this._headerInterval);
    this._headerInterval = null;
  }

  callback();

};

HeaderService.prototype._startHeaderSubscription = function() {

  this._bus.on('p2p/headers', this._onHeaders.bind(this));
  this._bus.subscribe('p2p/headers');

};

HeaderService.prototype.getPublishEvents = function() {

  return [
    {
      name: 'header/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];

};

HeaderService.prototype._queueBlock = function(block) {

  var self = this;
  if (block.rhash() === self.lastBlockQueried) {
    return;
  }

  self._blockProcessor.push(block, function(err) {

    if (err) {
      log.error(err);
      return self.node.stop();
    }

    log.debug('Header Service: completed processing block: ' + block.rhash() + ' prev hash: ' + bcoin.util.revHex(block.prevBlock));

  });

};

HeaderService.prototype._processBlocks = function(block, callback) {

  var self = this;

  assert(block.rhash() !== self._lastHeader.hash, 'Trying to save a header that has already been saved.');

  self._persistHeader(block, function(err) {

    if (err) {
      return callback(err);
    }

    async.eachSeries(self.node.services, function(mod, next) {
      if (!mod.newBlock) {
        return setImmediate(next);
      }
      mod.newBlock.call(mod, block, next);
    }, callback);

  });

};

HeaderService.prototype._persistHeader = function(block, callback) {

  var self = this;

  self._detectReorg(block, function(err, commonHeader) {

    if (err) {
      return callback(err);
    }

    if (!commonHeader) {

      return self._syncBlock(block, callback);

    }

    self._handleReorg(block, commonHeader, function(err) {

      if(err) {
        return callback(err);
      }

      self._syncBlock(block, callback);

    });

  });

};

HeaderService.prototype._formatHeader = function(block) {

  var header = block.toHeaders().toJSON();
  header.timestamp = header.ts;
  header.prevHash = header.prevBlock;
  return header;

};

HeaderService.prototype._syncBlock = function(block, callback) {

  var self = this;

  var header = self._formatHeader(block);

  log.debug('Header Service: new block: ' + block.rhash());

  self._saveHeaders(self._onHeader(header), function(err) {

    if (err) {
      return callback(err);
    }

    self._onHeadersSave();
    callback();
  });

};

HeaderService.prototype._broadcast = function(block) {
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('header/block', block);
  }
};

HeaderService.prototype._onHeader = function(header) {

  if (!header) {
    return;
  }

  header.height = this._lastHeader.height + 1;
  header.chainwork = this._getChainwork(header, this._lastHeader).toString(16, 64);

  if (!header.timestamp) {
    header.timestamp = header.time;
  }

  this._lastHeader = header;

  return [
    {
      type: 'put',
      key: this._encoding.encodeHeaderHashKey(header.hash),
      value: this._encoding.encodeHeaderValue(header)
    },
    {
      type: 'put',
      key: this._encoding.encodeHeaderHeightKey(header.height),
      value: this._encoding.encodeHeaderValue(header)
    }
  ];

};

HeaderService.prototype._onHeaders = function(headers) {

  var self = this;

  if (self._headerInterval) {
    clearInterval(self._headerInterval);
    self._headerInterval = null;
  }

  log.debug('Header Service: Received: ' + headers.length + ' header(s).');

  var dbOps = [];

  for(var i = 0; i < headers.length; i++) {

    var header = headers[i];

    header = header.toObject();

    assert(self._lastHeader.hash === header.prevHash, 'headers not in order: ' + self._lastHeader.hash +
      ' -and- ' + header.prevHash + ' Last header at height: ' + self._lastHeader.height);

    var ops = self._onHeader(header);

    dbOps = dbOps.concat(ops);

    self._tip.height = header.height;
    self._tip.hash = header.hash;
  }

  self._saveHeaders(dbOps, function(err) {
    if (err) {
      log.error(err);
      return self.node.stop();
    }
    self._onHeadersSave();
  });

};

HeaderService.prototype._saveHeaders = function(dbOps, callback) {

  var tipOps = utils.encodeTip(this._tip, this.name);

  dbOps.push({
    type: 'put',
    key: tipOps.key,
    value: tipOps.value
  });

  this._db.batch(dbOps, callback);
};

HeaderService.prototype._onHeadersSave = function(err) {

  var self = this;

  if (err) {
    log.error(err);
    self.node.stop();
    return;
  }

  self._logProgress();

  if (!self._syncComplete()) {

    self._sync();
    return;

  }

  self._startBlockSubscription();

  self._setBestHeader();

  self._initialSync = false;

  self.emit('headers');

};

HeaderService.prototype._startBlockSubscription = function() {

  if (this._subscribedBlock) {
    return;
  }

  this._subscribedBlock = true;

  this._bus.on('p2p/block', this._queueBlock.bind(this));
  this._bus.subscribe('p2p/block');

};

HeaderService.prototype._syncComplete = function() {

  return this._tip.height >= this._bestHeight;

};

HeaderService.prototype._setBestHeader = function() {

  var bestHeader = this._lastHeader;
  this._tip.height = bestHeader.height;
  this._tip.hash = bestHeader.hash;

  log.debug('Header Service: ' + bestHeader.hash + ' is the best block hash.');
};

HeaderService.prototype._getHeader = function(height, hash, callback) {

  var self = this;

  /*jshint -W018 */
  if (!hash && !(height >= 0)) {
    /*jshint +W018 */
    return callback(new Error('invalid arguments'));
  }


  var key;
  if (hash) {
    key = self._encoding.encodeHeaderHashKey(hash);
  } else {
    key = self._encoding.encodeHeaderHeightKey(height);
  }

  self._db.get(key, function(err, data) {

    if (err) {
      return callback(err);
    }

    if (!data) {
      return callback();
    }

    callback(null, self._encoding.decodeHeaderValue(data));

  });

};

HeaderService.prototype._detectReorg = function(block, callback) {

  var self = this;

  var prevHash = bcoin.util.revHex(block.prevBlock);
  var nextBlock = prevHash === self._lastHeader.hash;

  // common case
  if (nextBlock) {
    return callback(null, false);
  }

  // first we check if the new block's prev hash is already in our data set
  // if it is and this block isn't already in our data set too, then we have a reorg
  async.waterfall([
    function(next) {
      self.getBlockHeader(block.rhash(), next);
    },
    function(header, next) {
      if (header) {
        return callback(null, false);
      }
      self.getBlockHeader(prevHash, next);
    }
  ], function(err, header) {

    if (err) {
      return callback(err);
    }

    if (header) {
      return callback(null, header);
    }

    log.warn('Block: ' + block.rhash() + 'references: ' + prevHash +
      ' as its previous block, yet we have not stored this block in our data set, thus ignoring this block.');
    callback(null, false);

  });

};

HeaderService.prototype._handleReorg = function(block, commonHeader, callback) {

  var self = this;

  log.warn('Header Service: Reorganization detected, current tip hash: ' +
    self._tip.hash + ', new block causing the reorg: ' + block.rhash() +
    ' common ancestor hash: ' + commonHeader.hash + ' and height: ' +
    commonHeader.height);

  var reorgHeader = self._formatHeader(block);

  self.getAllHeaders(function(err, headers) {

    if (err || !headers) {
      return callback(err || new Error('Missing headers'));
    }

    var hash = block.rhash();
    headers.set(hash, reorgHeader); // appends to the end

    // this will ensure our own headers collection is correct
    self._onReorg(reorgHeader, headers, commonHeader, function(err) {

      if (err) {
        return callback(err);
      }

      async.eachSeries(self.node.services, function(mod, next) {
        if (!mod.newReorg) {
          return setImmediate(next);
        }
        mod.newReorg.call(mod, block, headers, next);
      }, callback);
    });

  });

};

HeaderService.prototype._onReorg = function(reorgHeader, headers, commonHeader, callback) {
  // remove all headers with a height greater than commonHeader
  var ops = [];
  var startingHeight = this._tip.height;
  var hash = this._tip.hash;
  while(hash !== commonHeader.hash) {
    var header = headers.getIndex(startingHeight--);
    assert(header, 'Expected to have a header at this height, but did not. Reorg failed.');
    hash = header.prevHash;
    ops.push({
      type: 'del',
      key: this._encoding.encodeHeaderHashKey(header.hash)
    });
    ops.push({
      type: 'del',
      key: this._encoding.encodeHeaderHeightKey(header.height)
    });
  }
  // setting our tip to the common ancestor
  this._tip.hash = commonHeader.hash;
  this._tip.height = commonHeader.height;
  this._lastHeader = commonHeader;

  this._db.batch(ops, callback);
};

HeaderService.prototype._setListeners = function() {

  this._p2p.on('bestHeight', this._onBestHeight.bind(this));

};

HeaderService.prototype._onBestHeight = function(height) {
  log.debug('Header Service: Best Height is: ' + height);
  this._bestHeight = height;
  this._startSync();
};

HeaderService.prototype._startSync = function() {

  var self = this;

  // if our tip height is less than the best height of this peer, then:
  // 1. the peer is not fully synced.
  // 2. the peer has reorg'ed and we need to handle this

  // unsub from listening for blocks
  // ensure the blockProcessor is finished processing blocks (empty queue)
  // then proceed with gathering new set(s) of headers

  self._bus.unsubscribe('p2p/block');

  async.retry(function(next) {

    next(self._blockProcessor.length !== 0);

  }, function() {

    self._numNeeded = self._bestHeight - self._tip.height;

    // common case
    if (self._numNeeded > 0) {
      log.info('Header Service: Gathering: ' + self._numNeeded + ' ' + 'header(s) from the peer-to-peer network.');
      self._sync();
    } else if (self._numNeeded < 0) {
      // this should be very uncommon
      self._handleLowTipHeight();
    }

  });

};

HeaderService.prototype._removeAllSubscriptions = function() {
  this._bus.unsubscribe('p2p/headers');
  this._bus.unsubscribe('p2p/block');
  this._bus.removeAllListeners();
};

HeaderService.prototype._findReorgConditionInNewPeer = function(callback) {

  var self = this;

  var newPeerHeaders = new utils.SimpleMap();
  var headerCount = 0;

  self.getAllHeaders(function(err, allHeaders) {

    if (err) {
      return callback(err);
    }

    self._bus.subscribe('p2p/headers');
    self._bus.on('p2p/headers', function(headers) {

      headers.forEach(function(header) {
        newPeerHeaders.set(header.hash, header);
        headerCount++;
      });

      if (headerCount < self._bestHeight) {
        return self._getP2PHeaders(headers[headers.length - 1].hash);
      }

      // We should have both sets of headers, work from latest header to oldest and find the common header.
      // Use the new set since we know this is a shorter list.
      var reorgInfo = { commonHeader: null, blockHash: null };

      for(var i = newPeerHeaders.length - 1; i >= 0; i--) {

        var newHeader = newPeerHeaders.getIndex(i);
        var oldHeader = allHeaders.get(newHeader.hash);

        if (oldHeader) {

          self._removeAllSubscriptions();

          // we found a common header, but no headers that at a greater height, this peer is not synced
          if (!reorgInfo.blockHash) {
            return callback();
          }

          reorgInfo.commonHeader = oldHeader;
          return callback(null, reorgInfo);
        }

        reorgInfo.blockHash = newHeader.hash;
      }

      // nothing matched...
      // at this point, we should wonder if we are connected to the wrong network
      assert(true, 'We tried to find a common header between current set of headers ' +
        'and the new peer\'s set of headers, but there were none. This should be impossible ' +
          ' if the new peer is using the same genesis block.');
    });

    self._getP2PHeaders(self.GENESIS_HASH);

  });

};

HeaderService.prototype._handleLowTipHeight = function() {
  var self = this;

  log.warn('Header Service: Connected Peer has a best height (' + self._bestHeight + ') which is lower than our tip height (' +
    self._tip.height + '). This means that this peer is not fully synchronized with the network -or- the peer has reorganized itself.' +
    ' Checking the new peer\'s headers for a reorganization event.');

  self._removeAllSubscriptions();

  self._findReorgConditionInNewPeer(function(err, reorgInfo) {

    if (err) {
      log.error(err);
      return self.node.stop();
    }

    // Our peer is not yet sync'ed.
    // We will just turn on our block subscription and wait until we get a block we haven't seen
    if (!reorgInfo) {
      self._onHeadersSave();
    }

    // our peer has reorg'ed to lower overall height.
    // we should get the first block after the split, reorg back to this height and then continue.
    self._p2p.getP2PBlock({
      filter: {
        startHash: reorgInfo.commonHeader.hash,
        endHash: 0
      },
      blockHash: reorgInfo.blockHash
    }, function(block) {

      self._handleReorg(block, reorgInfo.commonHeader, function(err) {

        if(err) {
          log.error(err);
          return self.node.stop();
        }

        self._syncBlock(block, function(err) {

          if (err) {
            log.error(err);
            return self.node.stop();
          }

          self._startHeaderSubscription();
          self._sync();

        });

      });
    });

  });


};

HeaderService.prototype._logProgress = function() {

  if (!this._initialSync) {
    return;
  }

  var progress;
  var bestHeight = Math.max(this._bestHeight, this._lastHeader.height);

  if (bestHeight === 0) {
    progress = 0;
  } else {
    progress = (this._tip.height/bestHeight*100.00).toFixed(2);
  }

  log.info('Header Service: download progress: ' + this._tip.height + '/' +
    bestHeight + '  (' + progress + '%)');

};

HeaderService.prototype._getP2PHeaders = function(hash) {

  var self = this;
  if (!self._headerInterval) {

    self._headerInterval = setInterval(function() {
      log.info('Header Service: we have not received a response to getHeaders from the network, retrying.');
      self._p2p.getHeaders({ startHash: hash });
    }, 2000);

  }

  self._p2p.getHeaders({ startHash: hash });

};

HeaderService.prototype._sync = function() {

  this._getP2PHeaders(this._tip.hash);

};

// this gets the header that is +2 places from hash or returns 0 if there is no such
HeaderService.prototype.getNextHash = function(tip, callback) {

  var self = this;
  var numResultsNeeded = 2;

  // if the tip being passed in is the second to last block, then return 0 because there isn't a block
  if (tip.height + 1 === self._tip.height) {
    numResultsNeeded = 1;
  }

  var start = self._encoding.encodeHeaderHeightKey(tip.height + 1);
  var end = self._encoding.encodeHeaderHeightKey(tip.height + 3);
  var results = [];

  var criteria = {
    gte: start,
    lt: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;

  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    results.push(self._encoding.decodeHeaderValue(data.value).hash);
  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    assert(results.length === numResultsNeeded, 'GetNextHash returned incorrect number of results.');

    if (!results[1]) {
      results[1] = 0;
    }

    callback(null, results[0], results[1]);

  });

};

HeaderService.prototype.getLastHeader = function() {
  assert(this._lastHeader, 'Last header should be populated.');
  return this._lastHeader;
};

HeaderService.prototype._getLastHeader = function(callback) {

  var self = this;

  var removalOps = [];

  var start = self._encoding.encodeHeaderHeightKey(self._tip.height);
  var end = self._encoding.encodeHeaderHeightKey(0xffffffff);

  log.info('Getting last header synced at height: ' + self._tip.height);

  var criteria = {
    gte: start,
    lte: end
  };

  var stream = self._db.createReadStream(criteria);

  var streamErr;
  stream.on('error', function(error) {
    streamErr = error;
  });

  stream.on('data', function(data) {
    var header  = self._encoding.decodeHeaderValue(data.value);

    // any records with a height greater than our current tip height can be scheduled for removal
    // because they will be replaced shortly
    if (header.height > self._tip.height) {
      removalOps.push({
        type: 'del',
        key: data.key
      });
      return;
    } else if (header.height === self._tip.height) {
      self._lastHeader = header;
    }

  });

  stream.on('end', function() {

    if (streamErr) {
      return streamErr;
    }

    assert(self._lastHeader, 'The last synced header was not in the database.');
    self._tip.hash = self._lastHeader.hash;
    self._db.batch(removalOps, callback);

  });

};

HeaderService.prototype._getChainwork = function(header, prevHeader) {

  var prevChainwork = new BN(new Buffer(prevHeader.chainwork, 'hex'));

  return this._computeChainwork(header.bits, prevChainwork);
};

HeaderService.prototype._computeChainwork = function(bits, prev) {

  var target = consensus.fromCompact(bits);

  if (target.isNeg() || target.cmpn(0) === 0) {
    return new BN(0);
  }

  var proof =  HeaderService.MAX_CHAINWORK.div(target.iaddn(1));

  if (!prev) {
    return proof;
  }

  return proof.iadd(prev);

};

module.exports = HeaderService;

