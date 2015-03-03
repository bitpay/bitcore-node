#!/usr/bin/env node

'use strict';

var config = require('config');
var BitcoreHTTP = require('./lib/http');

var app = BitcoreHTTP.create(config.get('BitcoreHTTP'));
app.start();

