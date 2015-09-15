# Database Service

An extensible interface to the bitcoin block chain. The service builds on the [Bitcoin Service](bitcoind.md), and includes additional methods for working with the block chain.

## API Documentation

Get Transaction

```js
var txid = 'c349b124b820fe6e32136c30e99f6c4f115fce4d750838edf0c46d3cb4d7281e';
var includeMempool = true;
node.getTransaction(txid, includeMempool, function(err, transaction) {
  //...
});
```

Get Transaction with Block Info

```js
var txid = 'c349b124b820fe6e32136c30e99f6c4f115fce4d750838edf0c46d3cb4d7281e';
var includeMempool = true;
node.getTransactionWithBlockInfo(txid, includeMempool, function(err, transaction) {
  //...
});
```

Get Block

```js
var blockHash = '00000000d17332a156a807b25bc5a2e041d2c730628ceb77e75841056082a2c2';
node.getBlock(blockHash, function(err, block) {
  //...
});
```

Get Block Hashes by Timestamp Range

```js
var newest = 1441914000; // Notice time is in seconds not milliseconds
var oldest = 1441911000;

node.getBlockHashesByTimestamp(newest, oldest, function(err, hashes) {
  //...
});
```
