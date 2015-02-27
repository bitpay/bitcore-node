'use strict';

var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/blocks', function(req, res, next) {
  res.send('blocks v1');
});

module.exports = router;
