'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var net = require('net');
var spawn = require('child_process').spawn;

var server;
var headers = [];
var blocks = [];
var magic = new Buffer('00', 'hex'); // TODO find out what this is
var messages = {
  verack: new Buffer('76657273696f6e0000000000', 'hex'),

};


/*


   comms path:

      client = bitcore-node
      server = my fake server

      client -> version

      server -> version

      client -> verack

      server -> verack

      client -> getHeaders

      server -> headers

      client -> ?

      server -> ?






*/

var startFakeNode = function(callback) {

  server = net.createServer(function(socket) {
    socket.write('hi\r\n');
    socket.pipe(socket);
  });

  server.listen(1337, '127.0.0.1');
  callback();
};


var shutdownFakeNode = function(done) {
  server.close();
  done();
};



describe('Reorg', function() {
  // 1. spin up bitcore-node and have it connect to our custom tcp socket
  // 2. feed it a few headers
  // 3. feed it a few blocks
  // 4. feed it a block that reorgs

  before(function(done) {
    startFakeNode(done);
  });

  after(function(done) {
    shutdownFakeNode(done);
  });

  it('should reorg correctly', function(done) {
    var client = new net.Socket();
    client.connect(1337, '127.0.0.1');
    client.on('data', function(data) {
      console.log(data.toString());
      client.destroy();
    });
    done();
  });
});

