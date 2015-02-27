'use strict';

var cors = require('cors')
var express = require('express');
var compress = require('compression');
var bodyParser = require('body-parser');

var routes = require('./routes');

function init(backend) {
  var app = express();

  // parse POST data
  app.use(cors());
  app.use(compress());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  // install routes
  app.use('/', routes(backend));

  // catch 404 and forward to error handler
  app.use(function(req, res, next) {
      var err = new Error('Not Found');
      err.status = 404;
      next(err);
  });

  // production error handler
  app.use(function(err, req, res, next) {
      res.status(err.status || 500);
      res.send({
          message: err.message,
          error: {}
      });
  });

  return app;
}

module.exports = init;
