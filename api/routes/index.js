'use strict';

var express = require('express');
var router = express.Router();

function initRouter(backend) {
  var v1 = require('./v1')(backend);
  var v2 = require('./v2')(backend);

  router.use('/v1', v1);
  router.use('/v2', v2);

  router.get('/', function(req, res, next) {
    res.send('bitcore node api');
  });

  return router;
}

module.exports = initRouter;
