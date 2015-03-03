'use strict';

var config = require('config');
var BitcoreHTTP = require('./lib/http');

var http = BitcoreHTTP.create(config.get('BitcoreHTTP'));
http.start();

