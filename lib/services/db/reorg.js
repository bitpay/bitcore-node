'use strict';
var index = require('../../');
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var log = index.log;
var async = require('async');

function Reorg(node) {
  this.node = node;
  this.db = node.db;
}

Reorg.prototype.handleReorg = function(block, callback) {
  var self = this;

  self.findCommonAncestor(block, function(err, ancestorHash) {
    if (err) {
      return done(err);
    }
    log.warn('Reorg common ancestor found:', ancestorHash);
    // Rewind the chain to the common ancestor
    async.whilst(
      function() {
        // Wait until the tip equals the ancestor hash
        return self.db.tip.hash !== ancestorHash;
      },
      function(removeDone) {

        var concurrentTip = self.tip;

        // TODO: expose prevHash as a string from bitcore
        var prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex');

        self.getBlock(prevHash, function(err, previousTip) {
          if (err) {
            removeDone(err);
          }

          // Undo the related indexes for this block
          self.disconnectBlock(tip, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
            previousTip.__height = self.tip.__height - 1;
            self.tip = previousTip;
            self.emit('removeblock', tip);
            removeDone();
          });

        });

      },
      callback
    );
  });
};

// Rewind concurrentTip to tip
Reorg.prototype.rewindConcurrentTip = function(callback) {
  
};

Reorg.prototype.findCommonAncestor = function(block, callback) {
  var self = this;

  var mainPosition = self.db.tip.hash;
  var forkPosition = block.hash;

  var mainHashesMap = {};
  var forkHashesMap = {};

  mainHashesMap[mainPosition] = true;
  forkHashesMap[forkPosition] = true;

  var commonAncestor = null;

  async.whilst(
    function() {
      return !commonAncestor;
    },
    function(next) {
      async.parallel(
        [
          function(next) {
            if(!mainPosition) {
              return next();
            }

            self.node.services.bitcoind.getBlockHeader(mainPosition, function(err, mainBlockHeader) {
              if(err) {
                return next(err);
              }

              if(mainBlockHeader && mainBlockHeader.prevHash) {
                mainHashesMap[mainBlockHeader.prevHash] = true;
                mainPosition = mainBlockHeader.prevHash;
              } else {
                mainPosition = null;
              }

              next();
            });
          },
          function(next) {
            if(!forkPosition) {
              return next();
            }

            self.node.services.bitcoind.getBlockHeader(forkPosition, function(err, forkBlockHeader) {
              if(err) {
                return next(err);
              }

              if(forkBlockHeader && forkBlockHeader.prevHash) {
                forkHashesMap[forkBlockHeader.prevHash] = true;
                forkPosition = forkBlockHeader.prevHash;
              } else {
                forkPosition = null;
              }

              next();
            });
          }
        ],
        function(err) {
          if(err) {
            return next(err);
          }

          if(forkPosition && mainHashesMap[forkPosition]) {
            commonAncestor = forkPosition;
          }

          if(mainPosition && forkHashesMap[mainPosition]) {
            commonAncestor = mainPosition;
          }

          if(!mainPosition && !forkPosition) {
            return next(new Error('Unknown common ancestor'));
          }

          next();
        }
      )
    },
    function(err) {
      done(err, commonAncestor);
    }
  );
};