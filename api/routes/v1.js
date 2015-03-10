'use strict';

var express = require('express');
var NodeStatus = require('../controllers/node');
var Blocks = require('../controllers/blocks');
var Transactions = require('../controllers/transactions');


function initRouter(node) {
  var router = express.Router();

  [NodeStatus, Blocks, Transactions].forEach(function(controller) {
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
  router.get('/transactions/:txHash/inputs', mockResponse);
  router.get('/transactions/:txHash/inputs/:index', mockResponse);

  // Output routes
  router.get('/transactions/:txHash/outputs', mockResponse);
  router.get('/transactions/:txHash/outputs/:index', mockResponse);

  // Address routes
  router.get('/addresses/:address', mockResponse);
  router.get('/addresses/:address/transactions', mockResponse);
  router.get('/addresses/:address/utxos', mockResponse);
  // TODO: check if this is really restful
  router.get('/addresses/:addresses/utxos', mockResponse);

  // error routes
  router.get('/blocks/*', Blocks.getBlockError);
  router.get('/transactions/*', Transactions.getTxError);

  return router;
}

module.exports = initRouter;
