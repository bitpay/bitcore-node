'use strict';

var socket = require('socket.io-client')('http://localhost:3000');
socket.on('connect', function(){
  console.log('connected');
});

socket.on('disconnect', function(){
  console.log('disconnected');
});

var message = {
  command: 'getOutputs',
  params: ['1HTxCVrXuthad6YW5895K98XmVsdMvvBSw', true]
};

socket.emit('message', message, function(response) {
  if(response.error) {
    console.log('Error', response.error);
    return;
  }

  console.log(response.result);
});