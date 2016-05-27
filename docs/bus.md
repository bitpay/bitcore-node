# Bus
The bus provides a way to subscribe to events from any of the services running. It's implemented abstract from transport specific implementation. The primary use of the bus in Bitcore Node is for subscribing to events via a web socket.

## Opening/Closing

```javascript

// a node is needed to be able to open a bus
var node = new Node(configuration);

// will create a new bus that is ready to subscribe to events
var bus = node.openBus();

// will remove all event listeners
bus.close();
```

## Subscribing/Unsubscribing

```javascript

// subscribe to all transaction events
bus.subscribe('bitcoind/rawtransaction');

// to subscribe to new block hashes
bus.subscribe('bitcoind/hashblock');

// unsubscribe
bus.unsubscribe('bitcoind/rawtransaction');
```
