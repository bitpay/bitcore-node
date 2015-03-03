'use strict';

var express = require('express');
var Blocks = require('../controllers/blocks');


function initRouter(node) {
  var router = express.Router();

  function mockResponse(req, res) {
    res.send({'message': 'This is a mocked response'});
  }

  // parameter middleware
  router.param('blockHash', Blocks.blockHashParam);

  // Node routes
  router.get('/node', mockResponse);

  // Block routes
  router.get('/blocks', mockResponse);
  router.get('/blocks/latest', mockResponse);
  router.get('/blocks/:blockHash([A-Fa-f0-9]{64})', Blocks.getBlock);
  router.get('/blocks/*', Blocks.getBlockError);
  router.get('/blocks/:height([0-9]+)', mockResponse);
  router.get('/blocks/:blockHash/transactions/:txIndex', mockResponse);

  // Transaction routes
  router.get('/transactions', mockResponse);
  router.get('/transactions/:txHash', mockResponse);
  router.get('/transactions/:txHash/addresses', mockResponse);
  router.get('/transactions/:txHash/outputs/addresses', mockResponse);
  router.get('/transactions/:txHash/inputs/addresses', mockResponse);
  router.post('/transactions/send', mockResponse);

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

  return router;
}

module.exports = initRouter;
