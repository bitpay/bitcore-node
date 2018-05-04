const cluster = require('cluster');
const { EventEmitter } = require('events');
const Chain = require('../chain');

const mongoose = require('mongoose');
const async = require('async');

const logger = require('../logger');
const Block = mongoose.model('Block');
const Transaction = mongoose.model('Transaction');

class AbstractConnector extends EventEmitter {
  constructor(params) {
    super();
    this.chain = params.chain;
    this.parentChain = params.parentChain;
    this.forkHeight = params.forkHeight;
    this.network = params.network;
    this.trustedPeers = params.trustedPeers;
    this.invCache = {};
    this.headersQueue = [];
    this.blockCache = {};
    this.syncing = false;
    this.blockRates = [];
    this.transactionQueue = async.queue(this.processTransaction.bind(this), 1);
    this.blockQueue = async.queue(this.processBlock.bind(this), 1);
    this.peerEvents;
    this.bitcoreLib = Chain[this.chain].lib;
    this.bitcoreP2p = Chain[this.chain].p2p;
  }

  async start() {
    if (cluster.isWorker) {
      return;
    }
    this.connect();
  }

  writeToCache(cacheType, value) {
    if (!this.invCache[cacheType]) {
      this.invCache[cacheType] = [];
    }
    this.invCache[cacheType].push(value);
  }

  connect() {
    this.peerEvents.on('peerready', peer => {
      logger.info(`Connected to peer ${peer.host}`, {
        chain: this.chain,
        network: this.network
      });
      this.emit('ready');
    });

    this.peerEvents.on('peerdisconnect', peer => {
      logger.warn(`Not connected to peer ${peer.host}`, {
        chain: this.chain,
        network: this.network
      });
    });

    this.peerEvents.on('peertx', (peer, message) => {
      if (!this.invCache.tx.includes(message.transaction.hash)) {
        this.writeToCache('tx', message.transaction.hash);
        if (this.invCache.tx.length > 1000) {
          this.invCache.tx.shift();
        }
        this.emit('transaction', message.transaction);
        this.transactionQueue.push(message.transaction);
      }
    });

    this.peerEvents.on('peerblock', (peer, message) => {
      if (!this.invCache.block.includes(message.block.hash)) {
        this.writeToCache('block', message.block.hash);
        if (this.invCache.block.length > 1000) {
          this.invCache.block.shift();
        }
        this.emit(message.block.hash, message.block);
        if (!this.syncing) {
          this.emit('block', message.block);
          this.blockQueue.push(message.block);
        }
      }
    });

    this.peerEvents.on('peerheaders', (peer, message) => {
      this.emit('headers', message.headers);
    });

    this.peerEvents.on('peerinv', (peer, message) => {
      if (!this.syncing) {
        let filtered = message.inventory.filter(inv => {
          let hash = this.bitcoreLib.encoding
            .BufferReader(inv.hash)
            .readReverse()
            .toString('hex');
          return !this.invCache[inv.type].includes(hash);
        });
        if (filtered.length) {
          peer.sendMessage(this.messages.GetData(filtered));
        }
      }
    });

    this.once('ready', () => {
      Block.handleReorg({ chain: this.chain, network: this.network }, () => {
        this.sync();
      });
    });

    this.connectToPeers();
    this.stayConnected = setInterval(() => {
      this.connectToPeers();
    }, 5000);
  }

  connectToPeers() {
    this.pool.connect();
  }

  stop() {
    clearInterval(this.stayConnected);
  }

  async getMyBestBlock({chain, network}) {
    return Block.getLocalTip({
      chain: chain || this.chain,
      network: network || this.network
    });
  }

  async sync(done) {
    var self = this;
    done = done || function() {};
    if (this.syncing) {
      return done();
    }
    this.syncing = true;
    let bestBlock = await this.getMyBestBlock();
    if (bestBlock.height === this.getPoolHeight()) {
      logger.verbose('Already synced', {
        chain: this.chain,
        network: this.network,
        height: bestBlock.height
      });
      self.syncing = false;
      return done();
    }
    if (this.parentChain && bestBlock.height < this.forkHeight) {
      let parentBestBlock = await this.getMyBestBlock({
        chain: this.parentChain,
        network: this.network
      });
      if (parentBestBlock.height < this.forkHeight) {
        return setTimeout(this.sync.bind(this), 5000);
      }
    }
    logger.info(`Syncing from ${bestBlock.height} to ${self.getPoolHeight()} for chain ${self.chain}`);
    let blockCounter = 0;
    async.during(
      function(cb) {
        self.getHeaders(function(err, headers) {
          logger.verbose(`Received ${headers.length} headers`);
          self.headersQueue = headers;
          cb(err, headers.length);
        });
      },
      function(cb) {
        let lastLog = 0;
        async.eachOfSeries(
          self.headersQueue,
          function(header, headerIndex, cb) {
            self.getBlock(header.hash, async function(err, block) {
              await self.addBlock({
                block,
                chain: self.chain,
                network: self.network,
                parentChain: self.parentChain,
                forkHeight: self.forkHeight
              });
              blockCounter++;
              if (Date.now() - lastLog > 100) {
                logger.info(
                  `Sync progress ${((bestBlock.height + blockCounter) / self.getPoolHeight() * 100).toFixed(3)}%`,
                  {
                    chain: self.chain,
                    network: self.network,
                    height: bestBlock.height + blockCounter
                  }
                );
                lastLog = Date.now();
              }
              cb(err);
            });
          },
          function(err) {
            cb(err);
          }
        );
      },
      function(err) {
        if (err) {
          logger.error(err);
          self.sync();
        } else {
          logger.info('Sync completed!!', {
            chain: self.chain,
            network: self.network
          });
          self.syncing = false;
        }
      }
    );
  }

  addBlock(params) {
    return Block.addBlock(params);
  }

  getPoolHeight() {
    return Object.values(this.pool._connectedPeers).reduce((best, peer) => {
      return Math.max(best, peer.bestHeight);
    }, 0);
  }

  _getHeaders(candidateHashes, callback) {
    let getHeaders = () => {
      this.pool.sendMessage(this.messages.GetHeaders({ starts: candidateHashes }));
    };
    let headersRetry = setInterval(() => {
      getHeaders();
    }, 5000);
    this.once('headers', headers => {
      clearInterval(headersRetry);
      callback(null, headers);
    });
    getHeaders();
  }

  getHeaders(callback) {
    Block.getLocatorHashes({ chain: this.chain, network: this.network }, (err, locatorHashes) => {
      if (err) {
        return callback(err);
      }
      this._getHeaders(locatorHashes, (err, headers) => {
        if (err) {
          return callback(err);
        }
        callback(null, headers);
      });
    });
  }

  getBlock(hash, callback) {
    let getBlock = () => {
      this.requestBlockFromPeers(hash);
    };
    let getBlockRetry = setInterval(() => {
      getBlock();
    }, 1000);
    this.once(hash, block => {
      clearInterval(getBlockRetry);
      callback && callback(null, block);
    });
    getBlock();
  }

  requestBlockFromPeers(hash) {
    this.pool.sendMessage(this.messages.GetData.forBlock(hash));
  }

  processBlock(block, callback) {
    Block.addBlock({ chain: this.chain, network: this.network, block }, err => {
      if (err) {
        logger.error(err);
      } else {
        logger.info(`Added block ${block.hash}`, {
          chain: this.chain,
          network: this.network
        });
      }
      callback(err);
    });
  }

  async processTransaction(tx) {
    return Transaction.batchImport({
      txs: [tx],
      height: -1,
      network: this.network,
      chain: this.chain,
      blockTime: new Date(),
      blockTimeNormalized: new Date()
    });
  }

  sendTransaction(rawTx) {
    this.pool.sendMessage(this.messages.Transaction(rawTx));
    return rawTx.txid;
  }
}

module.exports = AbstractConnector;
