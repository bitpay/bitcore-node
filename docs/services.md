---
title: Services
description: Overview of Bitcore Node services architecture.
---
# Services

## Overview

Bitcore Node has a service module system that can start up additional services that can include additional:

- Blockchain indexes (e.g. querying balances for addresses)
- API methods
- HTTP routes
- Event types to publish and subscribe

The `bitcore-node.json` file describes which services will load for a node:

```json
{
  "services": [
    "bitcoind", "db", "address", "insight-api"
  ]
}
```

Services correspond with a Node.js module as described in 'package.json', for example:

```json
{
  "dependencies": {
    "bitcore": "^0.13.1",
    "bitcore-node": "^0.2.0",
    "insight-api": "^3.0.0"
  }
}
```

*Note:* If you already have a bitcore-node database, and you want to query data from previous blocks in the blockchain, you will need to reindex. Reindexing right now means deleting your bitcore-node database and resyncing.

## Using Services Programmatically
If, instead, you would like to run a custom node, you can include services by including them in your configuration object when initializing a new node.

```js
//Require bitcore
var bitcore = require('bitcore-node');

//Services
var Address = bitcore.services.Address;
var Bitcoin = bitcore.services.Bitcoin;
var DB      = bitcore.services.DB;
var Web     = bitcore.services.Web;

var myNode = new bitcore.Node({
  datadir: '~/.bitcore',
  network: {
    name: 'livenet'
  },
  "services": [
    {
      name: "address",
      module: Address,
      config: {}
    },
    {
      name: 'bitcoind',
      module: Bitcoin,
      config: {}
    },
    {
      name: 'db',
      module: DB,
      config: {}
    },
    {
      name: 'web',
      module: Web,
      config: {
        port: 3001
      }
    }
  ]
});
```
Now that you've loaded your services you can access them via `myNode.services.<service-name>.<method-name>`. For example
if you wanted to check the balance of an address, you could access the address service like so.

```js
myNode.services.address.getBalance('1HB5XMLmzFVj8ALj6mfBsbifRoD4miY36v', false, function(err, total) {
  console.log(total); //Satoshi amount of this address
});
```

## Writing a Service

A new service can be created by inheriting from `Node.Service` and implementing these methods and properties:

- `Service.dependencies` -  An array of services that are needed, this will determine the order that services are started on the node.
- `Service.prototype.start()` - Called to start up the service.
- `Service.prototype.stop()` - Called to stop the service.
- `Service.prototype.blockHandler()` - Will be called when a block is added or removed from the chain, and is useful for updating a database view/index.
- `Service.prototype.getAPIMethods()` - Describes which API methods that this service includes, these methods can then be called over the JSON-RPC API, as well as the command-line utility.
- `Service.prototype.getPublishEvents()` - Describes which events can be subscribed to for this service, useful to subscribe to events over the included web socket API.
- `Service.prototype.setupRoutes()` - A service can extend HTTP routes on an express application by implementing this method.

The `package.json` for the service module can either export the `Node.Service` directly, or specify a specific module to load by including `"bitcoreNode": "lib/bitcore-node.js"`.

Please take a look at some of the existing services for implementation specifics.

### Adding an index

One quite useful feature exposed to services is the ability to index arbitrary data in the blockchain. To do so we make
use of leveldb, a simple key-value store. As a service we can expose a 'blockHandler' function which is called each time
a new block is added or removed from the blockchain. This gives us access to every new transaction received, allowing 
us to index them. Let's take a look at an example where we will index the time that a transaction was confirmed.

```js
//Index prefix, so that we can determine the difference between our index 
//and the indexes provided by other services
MyService.datePrefix = new Buffer('10', 'hex');

MyService.minPosition = new Buffer('00000', 'hex');
MyService.maxPosition = new Buffer('99999', 'hex');

//This function is automatically called when a block is added or receieved
MyService.prototype.prototype.blockHandler = function(block, addOutput, callback) {

  //Determine if the block is added or removed, and therefore whether we are adding
  //or deleting indexes
  var databaseAction = 'put';
  if (!addOutput) {
    databaseAction = 'del';
  }

  //An array of all leveldb operations we will be committing
  var operations = [];

  //Timestamp of the current block
  var blocktime = new Buffer(block.header.time);

  for (var i = 0; i < block.transactions.length; i++) {
    var transaction = block.transactions[i];
    var txid = new Buffer(transaction.id, 'hex');
    var position = new Buffer(('0000' + i).slice(-5));

    //To be able to query this txid by the block date we create an index, leading with the prefix we
    //defined earlier, the the current blocktime, and finally a differentiator, in this case the index
    //of this transaction in the block's transaction list
    var indexOperation = {
      type: databaseAction,
      key: Buffer.concat([this.datePrefix, blockTime, position]),
      value: txid
    };

    //Now we push this index into our list of operations that should be performed
    operations.push(indexOperation);
  }

  //Send the list of db operations back so they can be performed
  setImmediate(function() {
    callback(null, operations);
  });
};
```

### Retrieving data using an index
With our block handler code every transaction in the blockchain will now be indexed. However, if we want to query this 
data we need to add a method to our service to expose it.

```js

MyService.prototype.getTransactionIdsByDate = function(startDate, endDate, callback) {

  var error;
  var transactions = [];

  //Read data from leveldb which is between our startDate and endDate
  var stream = this.node.services.db.store.createReadStream({
    gte: Buffer.concat([
      MyService.datePrefix,
      new Buffer(startDate),
      MyService.minPosition
    ]),
    lte: Buffer.concat([
      MyService.datePrefix,
      new Buffer(endDate),
      MyService.maxPosition
    ]),
    valueEncoding: 'binary',
    keyEncoding: 'binary'
  });

  stream.on('data', function(data) {
    transactions.push(data.value.toString('hex'));
  });

  stream.on('error', function(streamError) {
    if (streamError) {
      error = streamError;
    }
  });

  stream.on('close', function() {
    if (error) {
      return callback(error);
    }
    callback(null, transactions);
  });
};
```

If you're new to leveldb and would like to better understand how createReadStream works you can find [more 
information here](https://github.com/Level/levelup#dbcreatereadstreamoptions).

### Understanding indexes

You may notice there are several pieces to the index itself. Let's take a look at each piece to make them easier
to understand.

#### Prefixes

Since leveldb is just a simple key-value store we need something to differentiate which keys are part of which index. If
we had two services trying to index on the same key, say a txid, they would overwrite each other and their queries would
return results from the other index. By introducing a unique prefix per index type that we can prepend our indexes with
prevents these collisions.

```js
//A simple example of indexing the number of inputs and ouputs given a transaction id

/** Wrong way **/
var index1key = new Buffer(transaction.id);
var index1value = transaction.inputs.length;

//Since this key has the same value it would just overwrite index1 when we write to the db
var index2key = new Buffer(transaction.id);
var index2value = transaction.outputs.length;


/** Right way **/
var index1prefix = new Buffer('11', 'hex');
var index2prefix = new Buffer('12', 'hex');

var index1key = Buffer.concat([index1prefix, new Buffer(transaction.id)]);
var index1value = transaction.inputs.length;

//Now that the keys are different, this won't overwrite the index
var index2key = Buffer.concat([index2prefix, new Buffer(transaction.id)]);
var index2value = transaction.outputs.length;
```

Remember that all indexes are global, so check to make sure no other services you are using make use of the same prefix
you plan to use in your service. We recommend documenting which prefixes you use and that you check for collisions with
popular services if you plan to release your service for others to use.

#### Index Key

The index key is the value you want to query by. This value should be deterministic so that it can be removed in the case
of a [re-org](https://en.bitcoin.it/wiki/Chain_Reorganization) resulting in a block removal. The value should be unique, as
no two indexes can be the same value. If you need two indexes with the same key value, consider adding a deterministic 
differentiator, such as a position in an array, or instead storing multiple values within the same index data.

#### Index Data

This is the data which is returned when you search by the index's key. This can be whatever you would like to retrieve.
Try to be efficient by not storing data that is already available elsewhere, such as storing a transaction ID instead of
an entire transaction.
