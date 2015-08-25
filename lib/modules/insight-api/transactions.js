'use strict';

var bitcore = require('bitcore');
var errors = require('../../errors');

function TxController(db) {
  this.db = db;
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

  this.db.getTransactionWithBlockInfo(txid, true, function(err, transaction) {
    if (err && err instanceof errors.Transaction.NotFound) {
      return res.status(404).send('Not found');
    } else if(err) {
      return res.send({
        error: err.toString()
      });
    }

    transaction.populateInputs(self.db, [], function(err) {
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
    confirmations = this.db.chain.tip.__height - transaction.__height;
  }

  var transformed = {
    txid: txObj.hash,
    version: txObj.version,
    locktime: txObj.nLockTime,
    blockhash: transaction.__blockHash,
    confirmations: confirmations,
    time: transaction.__timestamp ? Math.round(transaction.__timestamp / 1000) : Math.round(Data.now() / 1000), // can we get this from bitcoind?
    valueOut: transaction.outputAmount / 1e8,
    size: transaction.toBuffer().length,
    valueIn: transaction.inputAmount / 1e8,
    fees: transaction.getFee() / 1e8
  };

  transformed.vin = txObj.inputs.map(this.transformInput.bind(this));
  transformed.vout = txObj.outputs.map(this.transformOutput.bind(this));

  return transformed;
};

TxController.prototype.transformInput = function(input, index) {
  var transformed = {
    txid: input.prevTxId,
    vout: input.outputIndex,
    scriptSig: {
      hex: input.script,
      asm: null // TODO
    },
    sequence: input.sequenceNumber,
    n: index
  };

  if(input.output) {
    transformed.addr = bitcore.Script(input.output.script).toAddress(this.db.network).toString();
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
  var address = bitcore.Script(output.script).toAddress(this.db.network).toString();
  return {
    value: (output.satoshis / 1e8).toFixed(8),
    n: index,
    scriptPubKey: {
      asm: null, // TODO
      hex: output.script,
      addresses: [address],
      reqSigs: null, // TODO
      type: null // TODO
    },
    spentTxId: null, // TODO
    spentIndex: null, // TODO
    spentTs: null // TODO
  };
};

module.exports = TxController;