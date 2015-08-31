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
bus.subscribe('transaction');

// only subscribe to events relevant to a bitcoin address
bus.subscribe('address/transaction', ['13FMwCYz3hUhwPcaWuD2M1U2KzfTtvLM89']);

// unsubscribe
bus.unsubscribe('transaction');
```

