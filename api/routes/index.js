'use strict';


var express = require('express');
var router = express.Router();

function initRouter(node) {
  var v1 = require('./v1')(node);
  var v2 = require('./v2')(node);

  router.use('/v1', v1);
  router.use('/v2', v2);

  router.get('/', function(req, res) {
    res.send('bitcore-node API');
  });

  return router;
}

module.exports = initRouter;
