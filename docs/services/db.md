# Database Service
This service synchronizes a leveldb database with the [Bitcoin Service](bitcoind.md) block chain by connecting and disconnecting blocks to build new indexes that can be queried. Other services can extend the data that is indexed by implementing a `blockHandler` method, similar to the built-in [Address Service](address.md).

## Adding Indexes
For a service to include additional block data, it can implement a `blockHandler` method that will be run to when there are new blocks added or removed.

```js
CustomService.prototype.blockHandler = function(block, add, callback) {
  var transactions = block.transactions;
  var operations = [];
  operations.push({
    type: add ? 'put' : 'del',
    key: 'key',
    value: 'value'
  });
  callback(null, operations);
};
```

Take a look at the Address Service implementation for more details about how to encode the key, value for the best efficiency and ways to format the keys for streaming reads.

Additionally the mempool can have an index, the mempool index will be updated once bitcoind and the db have both fully synced. A service can implement a `resetMempoolIndex` method that will be run during this time, and the "synced" event will wait until this task has been finished:

```js
CustomService.prototype.resetMempoolIndex = function(callback) {
  var transactionBuffers = this.node.services.bitcoind.getMempoolTransactions();
  // interact over the transactions asynchronously here
  callback();
};
```

## API Documentation
These methods are exposed over the JSON-RPC interface and can be called directly from a node via:

```js
node.services.db.<methodName>
```

**Query Blocks by Date**

One of the additional indexes created by the Database Service is querying for blocks by ranges of dates:

```js
var newest = 1441914000; // Notice time is in seconds not milliseconds
var oldest = 1441911000;

node.services.db.getBlockHashesByTimestamp(newest, oldest, function(err, hashes) {
  // hashes will be an array of block hashes
});
```

**Working with Blocks and Transactions as Bitcore Instances**

```js

var txid = 'c349b124b820fe6e32136c30e99f6c4f115fce4d750838edf0c46d3cb4d7281e';
var includeMempool = true;
node.services.db.getTransaction(txid, includeMempool, function(err, transaction) {
  console.log(transaction.toObject());
});

var txid = 'c349b124b820fe6e32136c30e99f6c4f115fce4d750838edf0c46d3cb4d7281e';
var includeMempool = true;
node.services.db.getTransactionWithBlockInfo(txid, includeMempool, function(err, transaction) {
  console.log(transaction.toObject());
  console.log(transaction.__blockHash);
  console.log(transaction.__height);
  console.log(transaction.__timestamp);
});

var blockHash = '00000000d17332a156a807b25bc5a2e041d2c730628ceb77e75841056082a2c2';
node.services.db.getBlock(blockHash, function(err, block) {
  console.log(block.toObject());
});

// contruct a transaction
var transaction = bitcore.Transaction(<serializedString>);

node.services.db.sendTransaction(transaction, function(err) {
  if (err) {
    throw err;
  }
  // otherwise the transaction has been sent
});
```

## Events
For details on instantiating a bus for a node, see the [Bus Documentation](../bus.md).
- Name: `db/transaction`
- Name: `db/block`

**Examples:**

```js
bus.subscribe('db/transaction');
bus.subscribe('db/block');

bus.on('db/block', function(blockHash) {
  // blockHash will be a hex string of the block hash
});

bus.on('db/transaction', function(txInfo) {
  // see below
});
```

The `txInfo` object will have the format:

```js
{
  rejected: true, // If the transaction was rejected into the mempool
  tx: <Transaction> // a Bitcore Transaction instance
}
```
