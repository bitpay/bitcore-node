'use strict';

var env = process.env;

module.exports = {
  port: env.BITCORED_HTTP_PORT || 8000
}
