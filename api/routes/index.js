'use strict';

var express = require('express');
var router = express.Router();

var v1 = require('./v1');
var v2 = require('./v2');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.send('bitcore node api');
});

router.use('/v1', v1);
router.use('/v2', v2);

module.exports = router;
