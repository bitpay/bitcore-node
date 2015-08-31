# Address Service

The address service builds on the [Bitcoin Service](bitcoind.md) and the [Database Service](db.md) to add additional functionality for querying and subscribing to information based on bitcoin addresses.

## API Documentation

Get Unspent Outputs

```js
var address = '15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2';
var includeMempool = true;
node.getUnspentOutputs(address, includeMempool, function(err, unspentOutputs) {
  //...
});
```

View Balances

```js
var address = '15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2';
var includeMempool = true;
node.getBalance(address, includeMempool, function(err, balance) {
  //...
});
```

Get Outputs

```js
var address = '15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2';
var includeMempool = true;
node.getOutputs(address, includeMempool, function(err, outputs) {
  //...
});
```
