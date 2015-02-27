'use strict';

var express = require('express');

function initRouter(backend) {
  var router = express.Router();

  router.get('/blocks', function(req, res, next) {
    res.send('blocks v2 ' + backend.nodes);
  });

  return router;
}

module.exports = initRouter;
