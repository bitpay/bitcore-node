# Address Service

The address service builds on the [Bitcoin Service](bitcoind.md) and the [Database Service](db.md) to add additional functionality for querying and subscribing to information based on bitcoin addresses. This will typically represent the core functionality for wallet applications.

## API Documentation

These methods are exposed over the JSON-RPC interface and can be called directly from a node via:

```js
node.services.address.<methodName>
```

**Get Unspent Outputs**

One of the most common uses will be to retrieve unspent outputs necessary to create a transaction, here is how to get the unspent outputs for an address:

```js
var address = 'mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW';
var includeMempool = true;
node.services.address.getUnspentOutputs(address, includeMempool, function(err, unspentOutputs) {
  // see below
});
```

The `unspentOutputs` will have the format:

```js
[
  {
    address: 'mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW',
    txid: '9d956c5d324a1c2b12133f3242deff264a9b9f61be701311373998681b8c1769',
    outputIndex: 1,
    height: 150,
    satoshis: 1000000000,
    script: '76a9140b2f0a0c31bfe0406b0ccc1381fdbe311946dadc88ac',
    confirmations: 3
  }
]
```

**View Balances**

```js
var address = 'mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW';
var includeMempool = true;
node.services.address.getBalance(address, includeMempool, function(err, balance) {
  // balance will be in satoshis
});
```

**View Address History**

This method will give history of an address limited by a range of block heights by using
the "start" and "end" arguments. The "start" value is the more recent, and greater, block height.
The "end" value is the older, and lesser, block height. This feature is most useful for synchronization
as previous history can be omitted. Furthermore for large ranges of block heights, results can be
paginated by using the "from" and "to" arguments.

```js
var addresses = ['mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW'];
var options = {
  start: 345000,
  end: 344000,
  queryMempool: true
};
node.services.address.getAddressHistory(addresses, options, function(err, history) {
  // see below
});
```

The history format will be:
```js
{
  totalCount: 1, // The total number of items within "start" and "end"
  items: [
    {
      addresses: {
        'mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW': {
          inputIndexes: [],
          outputIndexes: [0]
        }
      },
      satoshis: 1000000000,
      height: 150, // the block height of the transaction
      confirmations: 3,
      timestamp: 1442948127, // in seconds
      fees: 191,
      tx: <Transaction> // the populated transaction
    }
  ]
}
```

**View Address Summary**

```js
var address = 'mgY65WSfEmsyYaYPQaXhmXMeBhwp4EcsQW';
var options = {
  noTxList: false
};

node.services.address.getAddressSummary(address, options, function(err, summary) {
  // see below
});
```

The `summary` will have the format (values are in satoshis):
```js
{
  totalReceived: 1000000000,
  totalSpent: 0,
  balance: 1000000000,
  unconfirmedBalance: 1000000000,
  appearances: 1, // number of transactions
  unconfirmedAppearances: 0,
  txids: [
    '3f7d13efe12e82f873f4d41f7e63bb64708fc4c942eb8c6822fa5bd7606adb00'
  ]
}
```

## Events

For details on instantiating a bus for a node, see the [Bus Documentation](../bus.md).

- Name: `address/transaction`, Arguments: `[address, address...]`
- Name: `address/balance`, Arguments: `[address, address...]`

**Examples:**

```js
bus.subscribe('address/transaction', ['13FMwCYz3hUhwPcaWuD2M1U2KzfTtvLM89']);
bus.subscribe('address/balance', ['13FMwCYz3hUhwPcaWuD2M1U2KzfTtvLM89']);

bus.on('address/transaction', function(transaction) {

});

bus.on('address/balance', function(balance) {

});
```