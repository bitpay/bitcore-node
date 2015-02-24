var winston = require('winston');
var config = require('../config');

var logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'error'
    }),
  ]
});
logger.transports.console.level = config.loggerLevel;

module.exports = logger;
