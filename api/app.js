'use strict';

var express = require('express');
var bodyParser = require('body-parser');

var config = require('./config');
var routes = require('./routes');


function API(backend, opts) {
  this.backend = backend;
  this.opts = opts;

  this._initApp();
}

API.prototype._initApp = function() {
  this.app = express();

  // parse POST data
  this.app.use(bodyParser.json());
  this.app.use(bodyParser.urlencoded({ extended: false }));

  // install routes
  this.app.use('/', routes);

  // catch 404 and forward to error handler
  this.app.use(function(req, res, next) {
      var err = new Error('Not Found');
      err.status = 404;
      next(err);
  });

  // production error handler
  this.app.use(function(err, req, res, next) {
      res.status(err.status || 500);
      res.send({
          message: err.message,
          error: {}
      });
  });
}

module.exports = API;
