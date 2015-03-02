'use strict';

var express = require('express');

function initRouter(node) {
  var router = express.Router();

  router.get('/blocks', function(req, res) {
    res.send('blocks v2 ');
  });

  return router;
}

module.exports = initRouter;
