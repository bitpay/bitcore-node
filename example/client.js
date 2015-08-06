'use strict';

var socket = require('socket.io-client')('http://localhost:3000');
socket.on('connect', function(){
  console.log('connected');
});

socket.on('disconnect', function(){
  console.log('disconnected');
});

var message = {
  method: 'getOutputs',
  params: ['2NChMRHVCxTPq9KeyvHQUSbfLaQY55Zzzp8', true]
};

socket.send(message, function(response) {
  if(response.error) {
    console.log('Error', response.error);
    return;
  }

  console.log(response.result);
});

var message2 = {
  method: 'getTransaction',
  params: ['4f793f67fc7465f14fa3a8d3727fa7d133cdb2f298234548b94a5f08b6f4103e', true]
};

socket.send(message2, function(response) {
  if(response.error) {
    console.log('Error', response.error);
    return;
  }

  console.log(response.result);
});

socket.on('transaction', function(obj) {
  console.log(JSON.stringify(obj, null, 2));
});

socket.on('address/transaction', function(obj) {
  console.log(JSON.stringify(obj, null, 2));
});

socket.emit('subscribe', 'transaction');
socket.emit('subscribe', 'address/transaction', ['13FMwCYz3hUhwPcaWuD2M1U2KzfTtvLM89']);