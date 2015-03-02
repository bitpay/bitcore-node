'use strict';

var http = require('http');
var cors = require('cors');
var express = require('express');
var compress = require('compression');
var bodyParser = require('body-parser');
var morgan = require('morgan');

var bitcore = require('bitcore');
var $ = bitcore.util.preconditions;
var BitcoreNode = require('../lib/node');

var routes = require('./routes');


function BitcoreHTTP(node, opts) {
  $.checkArgument(node);
  opts = opts || {};
  this.node = node;
  this.port = opts.port || 8000;
  this.setupExpress();
}

BitcoreHTTP.create = function(opts) {
  opts = opts || {};
  var node = BitcoreNode.create(opts.BitcoreNode);
  return new BitcoreHTTP(node, opts);
};


BitcoreHTTP.prototype.setupExpress = function() {
  var app = express();

  // parse POST data
  app.use(cors());
  app.use(compress());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({
    extended: false
  }));
  app.use(morgan('dev'));

  // install routes
  app.use('/', routes(this.node));

  // catch 404 and forward to error handler
  app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
  });

  // production error handler
  app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.send({
      message: err.message,
      error: {}
    });
  });

  app.set('port', this.port);

  var server = http.createServer(app);
  server.on('error', this.onError.bind(this));
  server.on('listening', this.onListening.bind(this));

  this.app = app;
  this.server = server;
};

/**
 * Event listener for HTTP server "error" event.
 */
BitcoreHTTP.prototype.onError = function(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string' ? 'Pipe ' + this.port : 'Port ' + this.port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
};

/**
 * Event listener for HTTP server "listening" event.
 */
BitcoreHTTP.prototype.onListening = function() {
  var addr = this.server.address();
  var bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
  console.log('Listening on ' + bind);
};


BitcoreHTTP.prototype.start = function() {
  this.server.listen(this.port);
};

module.exports = BitcoreHTTP;
