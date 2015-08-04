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

socket.send(message, function(response) {
  if(response.error) {
    console.log('Error', response.error);
    return;
  }

  console.log(response.result);
});

var message2 = {
  command: 'getTransaction',
  params: ['4f793f67fc7465f14fa3a8d3727fa7d133cdb2f298234548b94a5f08b6f4103e', true]
};

socket.send(message2, function(response) {
  if(response.error) {
    console.log('Error', response.error);
    return;
  }

  console.log(response.result);
});

socket.on('transaction', function(address, block) {
  console.log(address, block);
});

socket.emit('subscribe', 'transaction', ['13FMwCYz3hUhwPcaWuD2M1U2KzfTtvLM89']);