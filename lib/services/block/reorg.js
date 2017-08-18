'use strict';
var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var async = require('async');

function Reorg(node, block) {
  this.node = node;
  this.block = block;
  this.db = block.db;
}

Reorg.prototype.handleReorg = function(newBlockHash, callback) {
  var self = this;

  self.handleConcurrentReorg(function(err) {
    if(err) {
      return callback(err);
    }

    self.findCommonAncestorAndNewHashes(self.block.tip.hash, newBlockHash, function(err, commonAncestor, newHashes) {
      if(err) {
        return callback(err);
      }

      self.rewindBothTips(commonAncestor, function(err) {
        if(err) {
          return callback(err);
        }
        self.fastForwardBothTips(newHashes, callback);
      });
    });
  });
};

Reorg.prototype.handleConcurrentReorg = function(callback) {
  var self = this;

  if(self.block.concurrentTip.hash === self.block.tip.hash) {
    return callback();
  }

  self.findCommonAncestorAndNewHashes(
    self.block.concurrentTip.hash,
    self.block.tip.hash,
    function(err, commonAncestor, newHashes) {
    if(err) {
      return callback(err);
    }

    self.rewindConcurrentTip(commonAncestor, function(err) {
      if(err) {
        return callback(err);
      }

      self.fastForwardConcurrentTip(newHashes, callback);
    });
  });
};

Reorg.prototype.rewindConcurrentTip = function(commonAncestor, callback) {
  var self = this;

  async.whilst(
    function() {
      return self.block.concurrentTip.hash !== commonAncestor;
    },
    function(next) {
      self.block.getBlockOperations(self.block.concurrentTip, false, 'concurrent', function(err, operations) {
        if(err) {
          return next(err);
        }

        operations.push(self.block.getTipOperation(self.block.concurrentTip, false, 'concurrentTip'));
        self.db.batch(operations, function(err) {
          if(err) {
            return next(err);
          }

          var prevHash = BufferUtil.reverse(self.block.concurrentTip.header.prevHash).toString('hex');

          self.block.getBlocks([prevHash], function(err, blocks) {
            if(err) {
              return next(err);
            }

            self.block.concurrentTip = blocks[0];
            next();
          });
        });
      });


    },
    callback
  );
};

Reorg.prototype.fastForwardConcurrentTip = function(newHashes, callback) {
  var self = this;

  async.eachSeries(newHashes, function(hash, next) {
    self.block.getBlocks([hash], function(err, blocks) {
      if(err) {
        return next(err);
      }

      self.block.getBlockOperations(blocks[0], true, 'concurrent', function(err, operations) {
        if(err) {
          return next(err);
        }

        operations.push(self.block.getTipOperation(blocks[0], true, 'concurrentTip'));
        self.db.batch(operations, function(err) {
          if(err) {
            return next(err);
          }

          self.block.concurrentTip = blocks[0];
          next();
        });
      });
    });
  }, callback);
};

Reorg.prototype.rewindBothTips = function(commonAncestor, callback) {
  var self = this;

  async.whilst(
    function() {
      return self.block.tip.hash !== commonAncestor;
    },
    function(next) {
      async.parallel(
        [
          function(next) {
            self.block.getBlockOperations(self.block.concurrentTip, false, 'concurrent', function(err, operations) {
              if(err) {
                return next(err);
              }
              operations.push(self.block.getTipOperation(self.block.concurrentTip, false, 'concurrentTip'));
              next(null, operations);
            });
          },
          function(next) {
            self.block.getBlockOperations(self.block.tip, false, 'serial', function(err, operations) {
              if(err) {
                return next(err);
              }

              operations.push(self.block.getTipOperation(self.block.tip, false));
              next(null, operations);
            });
          }
        ],
        function(err, results) {
          if(err) {
            return callback(err);
          }

          var operations = results[0].concat(results[1]);
          self.db.batch(operations, function(err) {
            if(err) {
              return next(err);
            }

            var prevHash = BufferUtil.reverse(self.block.tip.header.prevHash).toString('hex');

            self.block.getBlocks([prevHash], function(err, blocks) {

              if(err) {
                return next(err);
              }

              self.block.concurrentTip = blocks[0];
              self.block.tip = blocks[0];
              next();
            });
          });
        }
      );
    },
    callback
  );
};

Reorg.prototype.fastForwardBothTips = function(newHashes, callback) {
  var self = this;

  async.eachSeries(newHashes, function(hash, next) {
    self.block.getBlocks([hash], function(err, blocks) {
      if(err) {
        return next(err);
      }

      async.parallel(
        [
          function(next) {
            self.block.getBlockOperations(blocks[0], true, 'concurrent', function(err, operations) {
              if(err) {
                return next(err);
              }

              operations.push(self.block.getTipOperation(blocks[0], true, 'concurrentTip'));
              next(null, operations);
            });
          },
          function(next) {
            self.block.getBlockOperations(blocks[0], true, 'serial', function(err, operations) {
              if(err) {
                return next(err);
              }

              operations.push(self.block.getTipOperation(blocks[0], true));
              next(null, operations);
            });
          }
        ],
        function(err, results) {
          if(err) {
            return next(err);
          }

          var operations = results[0].concat(results[1]);

          self.db.batch(operations, function(err) {
            if(err) {
              return next(err);
            }

            self.block.concurrentTip = blocks[0];
            self.block.tip = blocks[0];
            next();
          });
        }
      );
    });
  }, callback);
};

Reorg.prototype.findCommonAncestorAndNewHashes = function(oldTipHash, newTipHash, callback) {
  var self = this;

  var mainPosition = oldTipHash;
  var forkPosition = newTipHash;

  var mainHashesMap = {};
  var forkHashesMap = {};

  mainHashesMap[mainPosition] = true;
  forkHashesMap[forkPosition] = true;

  var commonAncestor = null;
  var newHashes = [forkPosition];

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

            self.block.getBlockHeader(mainPosition, function(err, mainBlockHeader) {
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

            self.block.getBlockHeader(forkPosition, function(err, forkBlockHeader) {
              if(err) {
                return next(err);
              }

              if(forkBlockHeader && forkBlockHeader.prevHash) {
                forkHashesMap[forkBlockHeader.prevHash] = true;
                forkPosition = forkBlockHeader.prevHash;
                newHashes.unshift(forkPosition);
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
      );
    },
    function(err) {
      if(err) {
        return callback(err);
      }

      // New hashes are those that are > common ancestor
      var commonAncestorFound = false;
      for(var i = newHashes.length - 1; i >= 0; i--) {
        if(newHashes[i] === commonAncestor) {
          commonAncestorFound = true;
        }

        if(commonAncestorFound) {
          newHashes.shift();
        }
      }

      callback(null, commonAncestor, newHashes);
    }
  );
};

module.exports = Reorg;
