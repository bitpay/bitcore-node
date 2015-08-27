'use strict';

function StatusController(node) {
  this.node = node;
}

StatusController.prototype.show = function(req, res) {
  
  var option = req.query.q;

  switch(option) {
    case 'getDifficulty':
      res.jsonp(this.getDifficulty());
      break;
    case 'getTxOutSetInfo':
      // TODO
      // break;
    case 'getLastBlockHash':
      // TODO
      // break;
    case 'getBestBlockHash':
      // TODO
      // break;
    case 'getInfo':
    default:
      res.jsonp(this.getInfo());
  }
};

StatusController.prototype.getInfo = function() {
  return this.node.bitcoind.getInfo();
};

StatusController.prototype.getDifficulty = function() {
  var info = this.node.bitcoind.getInfo();
  return {
    difficulty: info.difficulty
  };
};

StatusController.prototype.sync = function(req, res) {
  var status = 'syncing';
  if(this.node.bitcoind.isSynced() && this.node.chain.tip.__height === this.node.bitcoind.height) {
    status = 'finished';
  }

  var info = {
    status: status,
    blockChainHeight: this.node.bitcoind.height,
    syncPercentage: this.node.chain.tip.__height / this.node.bitcoind.height * 100,
    height: this.node.chain.tip.__height,
    error: null,
    type: 'bitcore node'
  };

  res.jsonp(info);
};

module.exports = StatusController;