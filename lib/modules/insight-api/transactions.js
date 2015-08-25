'use strict';

var bitcore = require('bitcore');
var errors = require('../../errors');
var common = require('./common');

function TxController(node) {
  this.node = node;
}

TxController.prototype.show = function(req, res) {
  if (req.transaction) {
    res.jsonp(req.transaction);
  }
};

/**
 * Find transaction by hash ...
 */
TxController.prototype.transaction = function(req, res, next, txid) {
  var self = this;

  this.node.getTransactionWithBlockInfo(txid, true, function(err, transaction) {
    if (err && err instanceof errors.Transaction.NotFound) {
      return common.handleErrors(null, res);
    } else if(err) {
      return common.handleErrors(err, res);
    }

    transaction.populateInputs(self.node.db, [], function(err) {
      if(err) {
        return res.send({
          error: err.toString()
        })
      }

      req.transaction = self.transformTransaction(transaction);
      next();
    });
  });
};

TxController.prototype.transformTransaction = function(transaction) {
  var txObj = transaction.toObject();

  var confirmations = 0;
  if(transaction.__height >= 0) {
    confirmations = this.node.chain.tip.__height - transaction.__height + 1;
  }

  var transformed = {
    txid: txObj.hash,
    version: txObj.version,
    locktime: txObj.nLockTime
  };

  transformed.vin = txObj.inputs.map(this.transformInput.bind(this));
  transformed.vout = txObj.outputs.map(this.transformOutput.bind(this));

  transformed.blockhash = transaction.__blockHash;
  transformed.confirmations = confirmations;
  transformed.time = transaction.__timestamp ? transaction.__timestamp : Date.now(); // can we get this from bitcoind?
  transformed.blocktime = transformed.time;
  transformed.valueOut = transaction.outputAmount / 1e8;
  transformed.size = transaction.toBuffer().length,
  transformed.valueIn = transaction.inputAmount / 1e8;
  transformed.fees = transaction.getFee() / 1e8;

  return transformed;
};

TxController.prototype.transformInput = function(input, index) {
  var transformed = {
    txid: input.prevTxId,
    vout: input.outputIndex,
    scriptSig: {
      asm: null, // TODO
      hex: input.script
    },
    sequence: input.sequenceNumber,
    n: index
  };

  if(input.output) {
    transformed.addr = bitcore.Script(input.output.script).toAddress(this.node.network).toString();
    transformed.valueSat = input.output.satoshis;
    transformed.value = input.output.satoshis / 1e8;
    transformed.doubleSpentTxID = null; // TODO
    transformed.isConfirmed = null; // TODO
    transformed.confirmations = null; // TODO
    transformed.unconfirmedInput = null; // TODO
  }

  return transformed;
};

TxController.prototype.transformOutput = function(output, index) {
  var address = bitcore.Script(output.script).toAddress(this.node.network).toString();
  return {
    value: (output.satoshis / 1e8).toFixed(8),
    n: index,
    scriptPubKey: {
      asm: null, // TODO
      hex: output.script,
      reqSigs: null, // TODO
      type: null, // TODO
      addresses: [address]
    },
    spentTxId: null, // TODO
    spentIndex: null, // TODO
    spentTs: null // TODO
  };
};

TxController.prototype.rawTransaction = function(req, res, next, txid) {
  this.node.getTransaction(txid, true, function(err, transaction) {
    if (err && err instanceof errors.Transaction.NotFound) {
      return common.handleErrors(null, res);
    } else if(err) {
      return common.handleErrors(err, res);
    }

    req.rawTransaction = {
      'rawtx': transaction.toBuffer().toString('hex')
    };

    next();
  });
};

TxController.prototype.showRaw = function(req, res) {
  if (req.rawTransaction) {
    res.jsonp(req.rawTransaction);
  }
};

module.exports = TxController;