'use strict';

var express = require('express');
var NodeStatus = require('../controllers/node');
var Blocks = require('../controllers/blocks');
var Transactions = require('../controllers/transactions');
var Addresses = require('../controllers/addresses');


function initRouter(node) {
  var router = express.Router();

  [NodeStatus, Blocks, Transactions, Addresses].forEach(function(controller) {
    controller.setNode(node);
  });

  function mockResponse(req, res) {
    res.send({
      'message': 'This is a mocked response'
    });
  }

  // parameter middleware
  router.param('blockHash', Blocks.blockHashParam);
  router.param('height', Blocks.heightParam);
  router.param('txHash', Transactions.txHashParam);
  router.param('address', Addresses.addressParam);

  // Node routes
  router.get('/node', NodeStatus.getStatus);

  // Block routes
  router.get('/blocks', Blocks.list);
  router.get('/blocks/latest', Blocks.getLatest);
  router.get('/blocks/:blockHash([A-Fa-f0-9]{64})', Blocks.get);
  router.get('/blocks/:height([0-9]+)', Blocks.get);

  // Transaction routes
  router.get('/transactions/:txHash([A-Fa-f0-9]{64})', Transactions.get);
  router.post('/transactions/send', Transactions.send);

  // Input routes
  router.get('/transactions/:txHash([A-Fa-f0-9]{64})/inputs', mockResponse);
  router.get('/transactions/:txHash([A-Fa-f0-9]{64})/inputs/:index([0-9]+)', mockResponse);

  // Output routes
  router.get('/transactions/:txHash([A-Fa-f0-9]{64})/outputs', mockResponse);
  router.get('/transactions/:txHash([A-Fa-f0-9]{64})/outputs/:index([0-9]+)', mockResponse);

  // Address routes
  router.get('/addresses/:address', Addresses.get);
  router.get('/addresses/:address/transactions', Transactions.list);
  router.get('/addresses/:address/utxos', mockResponse);
  // TODO: check if this is really restful
  router.get('/addresses/:addresses/utxos', mockResponse);

  // error routes
  router.get('/blocks/*', Blocks.getBlockError);
  router.get('/transactions/*', Transactions.getTxError);

  return router;
}

module.exports = initRouter;
