# Bitcoin Service
The Bitcoin Service adds a native [Node.js](https://nodejs.org) interface to [Bitcoin Core](https://github.com/bitcoin/bitcoin) for querying information about the Bitcoin blockchain. Bindings are linked to Bitcoin Core compiled as a static library.

## API Documentation
These methods are currently only available via directly interfacing with a node:

```js
node.services.bitcoind.<methodName>
```

**Getting Block Information**

It's possible to query blocks by both block hash and by height. Blocks are given as Node.js buffers and can be parsed via Bitcore:

```js
var blockHeight = 0;
node.services.bitcoind.getBlock(blockHeight, function(err, blockBuffer) {
  if (err) {
    throw err;
  }
  var block = bitcore.Block.fromBuffer(blockBuffer);
  console.log(block);
};

// check if the block is part of the main chain
var mainChain = node.services.bitcoind.isMainChain(block.hash);
console.log(mainChain);

// get only the block index (including chain work and previous hash)
var blockIndex = node.services.bitcoind.getBlockIndex(blockHeight);
console.log(blockIndex);
```

**Retrieving and Sending Transactions**

Get a transaction asynchronously by reading it from disk, with an argument to optionally not include the mempool:

```js
var txid = '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623';
var queryMempool = true;
node.services.bitcoind.getTransaction(txid, queryMempool, function(err, transactionBuffer) {
  if (err) {
    throw err;
  }
  var transaction = bitcore.Transaction().fromBuffer(transactionBuffer);
});


// also retrieve the block timestamp and height
node.services.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, info) {
  console.log(info.blockHash);
  console.log(info.height);
  console.log(info.timestamp); // in seconds
  var transaction = bitcore.Transaction().fromBuffer(transactionBuffer);
});
```

Send a transaction to the network:

```js
var numberOfBlocks = 3;
var feesPerKilobyte = node.services.bitcoind.estimateFee(numberOfBlocks); // in satoshis

try {
  node.services.bitcoind.sendTransaction(transaction.serialize());
} catch(err) {
  // handle error
}
```

Get all of the transactions in the mempool:

```js
var mempool = node.services.bitcoind.getMempoolTransactions();
var transactions = [];
for (var i = 0; i < mempool.length; i++) {
  transactions.push(bitcore.Transaction().fromBuffer(transactions[i]));
}
```

Determine if an output is spent (excluding the mempool):

```js
var spent = node.services.bitcoind.isSpent(txid, outputIndex);
console.log(spent);
```

**Miscellaneous**
- `bitcoind.start(callback)` - Start the JavaScript Bitcoin node, the callback is called when the daemon is ready.
- `bitcoind.getInfo()` - Basic information about the chain including total number of blocks.
- `bitcoind.isSynced()` - Returns a boolean if the daemon is fully synced (not the initial block download)
- `bitcoind.syncPercentage()` - Returns the current estimate of blockchain download as a percentage.
- `bitcoind.stop(callback)` - Stop the JavaScript bitcoin node safely, the callback will be called when bitcoind is closed. This will also be done automatically on `process.exit`. It also takes the bitcoind node off the libuv event loop. If the daemon object is the only thing on the event loop. Node will simply close.

## Events
The Bitcoin Service doesn't expose any events via the Bus, however there are a few events that can be directly registered:

```js
node.services.bitcoind.on('tip', function(blockHash) {
  // a new block tip has been added
});

node.services.bitcoind.on('tx', function(txInfo) {
  // a new transaction has been broadcast in the network
});
```

The `txInfo` object will have the format:

```js
{
  buffer: <Buffer...>,
  mempool: true,
  hash: '7426c707d0e9705bdd8158e60983e37d0f5d63529086d6672b07d9238d5aa623'
}
```
