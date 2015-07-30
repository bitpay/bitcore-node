'use strict';

var BitcoinNode = require('..').Node;
var chainlib = require('chainlib');
var io = require('socket.io');
var log = chainlib.log;
log.debug = function() {};

var configuration = {
  datadir: process.env.BITCOINDJS_DIR || '~/.bitcoin',
  network: process.env.BITCOINDJS_NETWORK || 'livenet'
};

var node = new BitcoinNode(configuration);

var count = 0;
var interval;

node.on('ready', function() {

  interval = setInterval(function() {
    log.info('Sync Status: Tip:', node.chain.tip.hash, 'Height:', node.chain.tip.__height, 'Rate:', count/10, 'blocks per second');
    count = 0;
  }, 10000);

  io.on('connection', function(socket) {

    var bus = node.openBus();

    var methods = node.getAllAPIMethods();
    var methodsMap = {};

    methods.forEach(function(data) {
      var name = data[0];
      var instance = data[1];
      var method = data[2];
      methodsMap[name] = function() {
        return method.apply(instance, arguments);
      };
    });

    socket.on('message', function(message) {
      if (methodsMap[message.command]) {
        methodsMap[message.command](message.params);
      }
    });

    socket.on('subscribe', function(name, params) {
      bus.subscribe(name, params);
    });

    socket.on('unsubscribe', function(name, params) {
      bus.unsubscribe(name, params);
    });

    var events = node.getAllPublishEvents();

    events.forEach(function(event) {
      bus.on(event.name, function(data) {
        socket.emit(event.name, data);
      });
    });

    socket.on('disconnect', function() {
      bus.close();
    });

  });

});

node.on('error', function(err) {
  log.error(err);
});

node.chain.on('addblock', function(block) {
  count++;
});
