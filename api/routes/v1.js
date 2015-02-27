'use strict';

var express = require('express');

function initRouter(backend) {
  var router = express.Router();

  function mockResponse(req, res, next) {
    res.send('This is a mocked response. Backed service is: ' + backend.status);
  }

  router.get('/blocks', mockResponse);
  router.get('/block/:blockHash', mockResponse);
  router.get('/block-index/:height', mockResponse);

  // Transaction routes
  router.get('/tx/:txid', mockResponse);
  router.get('/txs', mockResponse);
  router.post('/tx/send', mockResponse);

  // Address routes
  router.get('/addr/:addr', mockResponse);
  router.get('/addr/:addr/utxo', mockResponse);
  router.get('/addrs/:addrs/utxo', mockResponse);
  router.post('/addrs/utxo', mockResponse);
  router.get('/addrs/:addrs/txs', mockResponse);
  router.post('/addrs/txs', mockResponse);

  // Address property routes
  router.get('/addr/:addr/balance', mockResponse);
  router.get('/addr/:addr/totalReceived', mockResponse);
  router.get('/addr/:addr/totalSent', mockResponse);
  router.get('/addr/:addr/unconfirmedBalance', mockResponse);

  // Status route
  router.get('/status', mockResponse);
  router.get('/sync', mockResponse);
  router.get('/peer', mockResponse);

  // Currency
  router.get('/currency', mockResponse);

  // Address routes
  router.get('/messages/verify', mockResponse);
  router.post('/messages/verify', mockResponse);

  return router;
}

module.exports = initRouter;
