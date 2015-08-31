# Services

## Available Services

- [Bitcoin Daemon](services/bitcoind.md)
- [DB](services/db.md)
- [Address](services/address.md)

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

Please take a look at some of the existing services for implemenation specifics.
