var bcoin = require('bcoin').set('main');

var node = bcoin.fullnode({
  checkpoints: true,
  // Primary wallet passphrase
  logLevel: 'info'
});

// We get a lot of errors sometimes,
// usually from peers hanging up on us.
// Just ignore them for now.
node.on('error', function(err) {
  console.log(err);
});

// Start the node
node.open().then(function() {
  node.connect().then(function() {
    node.startSync();
  });
});
