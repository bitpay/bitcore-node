import * as winston from "winston";

const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      colorize: true
    })
  ]
});

export default logger;
