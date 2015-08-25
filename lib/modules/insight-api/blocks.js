'use strict';

function BlockController(db) {
  this.db = db;
}

/**
 * Find block by hash ...
 */
BlockController.prototype.block = function(req, res, next, hash) {
  var self = this;

  this.db.getBlock(hash, function(err, block) {
    if(err && err.message === 'Block not found.') {
      // TODO libbitcoind should pass an instance of errors.Block.NotFound
      return res.status(404).send('Not found');
    } else if(err) {
      return res.status.send({
        error: err.toString()
      });
    }

    var info = self.db.bitcoind.getBlockIndex(hash);

    req.block = self.transformBlock(block, info);
    next();
  });
};

BlockController.prototype.transformBlock = function(block, info) {
  var transactions = this.db.getTransactionsFromBlock(block);
  var transactionIds = transactions.map(function(tx) {
    return tx.hash
  });
  return {
    hash: block.hash,
    confirmations: this.db.chain.tip.__height - info.height + 1,
    size: block.toBuffer().length, // This is probably not the right size...
    height: info.height,
    version: block.version,
    merkleroot: block.merkleRoot,
    tx: transactionIds,
    time: Math.round(block.timestamp.getTime() / 1000),
    nonce: block.nonce,
    bits: block.bits.toString(16),
    difficulty: 0, // placeholder
    chainwork: info.chainWork, // placeholder
    previousblockhash: block.prevHash,
    reward: 0, // First output of first transaction gives us the reward + fees. How to isolate just reward?
    isMainChain: true // placeholder
  }
};

/**
 * Show block
 */
BlockController.prototype.show = function(req, res) {
  if (req.block) {
    res.jsonp(req.block);
  }
};

BlockController.prototype.blockIndex = function(req, res, next, height) {
  var info = this.db.bitcoind.getBlockIndex(parseInt(height));
  if(!info) {
    return res.status(404).send('Not found');
  }

  res.jsonp({
    blockHash: info.hash
  });
};

// List blocks by date
BlockController.prototype.list = function(req, res) {

  res.status(501).send('Not implemented');
  /*var isToday = false;

  //helper to convert timestamps to yyyy-mm-dd format
  var formatTimestamp = function(date) {
    var yyyy = date.getUTCFullYear().toString();
    var mm = (date.getUTCMonth() + 1).toString(); // getMonth() is zero-based
    var dd = date.getUTCDate().toString();

    return yyyy + '-' + (mm[1] ? mm : '0' + mm[0]) + '-' + (dd[1] ? dd : '0' + dd[0]); //padding
  };

  var dateStr;
  var todayStr = formatTimestamp(new Date());

  if (req.query.blockDate) {
    // TODO: Validate format yyyy-mm-dd
    dateStr = req.query.blockDate;
    isToday = dateStr === todayStr;
  } else {
    dateStr = todayStr;
    isToday = true;
  }
  var gte = Math.round((new Date(dateStr)).getTime() / 1000);

  //pagination
  var lte = parseInt(req.query.startTimestamp) || gte + 86400;
  var prev = formatTimestamp(new Date((gte - 86400) * 1000));
  var next = lte ? formatTimestamp(new Date(lte * 1000)) :null;
  var limit = parseInt(req.query.limit || DFLT_LIMIT) + 1;
  var more;

  bdb.getBlocksByDate(gte, lte, limit, function(err, blockList) {

    if (err) {
      res.status(500).send(err);
    } else {
      var l = blockList.length;

      if (l===limit) {
        more = true;
        blockList.pop;
      }

      var moreTs=lte;
      async.mapSeries(blockList,
        function(b, cb) {
          getBlock(b.hash, function(err, info) {
            if (err) {
              console.log(err);
              return cb(err);
            }
            if (b.ts < moreTs) moreTs = b.ts;
            return cb(err, {
              height: info.height,
              size: info.size,
              hash: b.hash,
              time: b.ts || info.time,
              txlength: info.tx.length,
              poolInfo: info.poolInfo
            });
          });
        }, function(err, allblocks) {

          // sort blocks by height
          allblocks.sort(
            function compare(a,b) {
              if (a.height < b.height) return 1;
              if (a.height > b.height) return -1;
              return 0;
            });
          
          res.jsonp({
            blocks: allblocks,
            length: allblocks.length,
            pagination: {
              next: next,
              prev: prev,
              currentTs: lte - 1,
              current: dateStr,
              isToday: isToday,
              more: more,
              moreTs: moreTs,
            }
          });
        });
    }
  });*/
};

module.exports = BlockController;