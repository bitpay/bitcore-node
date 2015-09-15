#!/usr/bin/env node

'use strict';

var start = require('../lib/scaffold/start');
var defaultConfig = require('../lib/scaffold/default-config');

start(defaultConfig());
