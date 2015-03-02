'use strict';

var express = require('express');

function initRouter(backend) {
  var router = express.Router();

  function mockResponse(req, res, next) {
    res.send({'message': 'This is a mocked response'});
    next();
  }

  // Node routes
  router.get('/node', mockResponse);

  // Block routes
  router.get('/blocks', mockResponse);
  router.get('/blocks/latest', mockResponse);
  router.get('/blocks/:blockHash', mockResponse);
  router.get('/blocks/:height', mockResponse);
  router.get('/blocks/:blockHash/transactions/:txIndex', mockResponse);

  // Transaction routes
  router.get('/transactions', mockResponse);
  router.get('/transactions/:txHash', mockResponse);
  router.post('/transactions/send', mockResponse);
  router.get('/transactions/:txHash/addresses', mockResponse);
  router.get('/transactions/:txHash/outputs/addresses', mockResponse);
  router.get('/transactions/:txHash/inputs/addresses', mockResponse);

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
