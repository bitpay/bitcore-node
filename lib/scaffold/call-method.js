'use strict';

var socketClient = require('socket.io-client');

/**
 * Calls a remote node with a method and params
 * @param {Object} options
 * @param {String} method - The name of the method to call
 * @param {Array} params - An array of the params for the method
 * @param {Function} done - The callback function
 */
function callMethod(options, method, params, done) {

  var host = options.host;
  var protocol = options.protocol;
  var port = options.port;
  var url = protocol + '://' + host + ':' + port;
  var socketOptions = {
    reconnection: false,
    connect_timeout: 5000
  };
  var socket = socketClient(url, socketOptions);

  socket.on('connect', function(){
    socket.send({
      method: method,
      params: params,
    }, function(response) {
      if (response.error) {
        return done(new Error(response.error.message));
      }
      socket.close();
      done(null, response.result);
    });
  });

  socket.on('connect_error', done);

  return socket;

}

module.exports = callMethod;
