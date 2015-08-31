# Node

A node represents a collection of services that are loaded together. For more information about services, please see the [Services Documentation](services.md).

## API Documentation

- `start()` - Will start the node's services in the correct order based on the dependencies of a service.
- `stop()` - Will stop the node's services.
- `openBus()` - Will create a new event bus to subscribe to events.
- `getAllAPIMethods()` - Returns information about all of the API methods from the services.
- `getAllPublishEvents()` - Returns information about publish events.
- `getServiceOrder()` - Returns an array of service modules.
- `services.<service-name>.<method>` - Additional API methods exposed by each service. The services for the node are defined when the node instance is constructed.

## Example Usage

```js

var BitcoinNode = require('bitcore-node').Node;

var configuration = {
  datadir: '~/.bitcoin',
  network: 'testnet'
};

var node = new BitcoinNode(configuration);

node.on('ready', function() {
  console.log('Bitcoin Node Ready');
});

node.on('error', function(err) {
  console.error(err);
});

// shutdown the node
node.stop(function() {
  // the shutdown is complete
});

```
