'use strict';

var p2p = require('bitcore-p2p');
var messages = new p2p.Messages();
var opts = {};
opts.addrs = [ { ip: { v4: '192.168.3.5' } } ];
opts.dnsSeed = false;
opts.maxPeers = 1;
opts.network = 'livenet';
var pool = new p2p.Pool(opts);

pool.on('peerready', function(peer, addr) {
  console.log('Connected to peer: ' + addr.ip.v4);
  peer.sendMessage(messages.MemPool());
});

pool.on('peerdisconnect', function(peer, addr) {
  console.log('Disconnected from peer: ' + addr.ip.v4);
});

pool.on('peerinv', function(peer, message) {
  var invList = [];
  message.inventory.forEach(function(inv) {
    invList.push(inv);
  });
  peer.sendMessage(messages.GetData(invList));
});

// pool.on('peertx', function(peer, message) {
//   var tx = new bitcore.Transaction(message.transaction);
//   if (self.validTx(tx)) {
//     return self._cache.set(tx.id, tx);
//   }
//   return self._operations.push({
//     type: 'put',
//     key: new Buffer(tx.id),
//     value: tx.toBuffer()
//   });
// });

