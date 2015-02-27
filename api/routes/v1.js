'use strict';

var express = require('express');

function initRouter(backend) {
  var router = express.Router();

  router.get('/blocks', function(req, res, next) {
    res.send('blocks v1' + backend.status);
  });

  return router;
}

module.exports = initRouter;
