Bitcore Node
===========

A Node.js module that adds a native interface to Bitcoin Core for querying information about the Bitcoin blockchain. Bindings are linked to Bitcore Core compiled as a shared library.

## Install

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
npm install
```

## Example Usage

```js

var BitcoinNode = require('bitcore-node');

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

node.chain.on('addblock', function(block) {
  console.log('New Best Tip:', block.hash);
});

```

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

Get Transaction

```js
var txid = 'c349b124b820fe6e32136c30e99f6c4f115fce4d750838edf0c46d3cb4d7281e';
var includeMempool = true;
node.getTransaction(txid, includeMempool, function(err, transaction) {
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

You can log output from the daemon using:

``` bash
$ tail -f ~/.bitcoin/debug.log
```

^C (SIGINT) will call `StartShutdown()` in bitcoind on the node thread pool.

## Modules

Bitcore Node has a module system where additional information can be indexed and queried from
the blockchain. One built-in module is the address module which exposes the API methods for getting balances and outputs.

### Writing a Module

A new module can be created by inheriting from `Node.Module`, implementing the methods `blockHandler()`, `getAPIMethods()`, `getPublishEvents()` and any additional methods for querying the data. Here is an example:

```js
var inherits = require('util').inherits;
var Node = require('bitcore-node').Node;

var MyModule = function(options) {
  Node.Module.call(this, options);
};

inherits(MyModule, Node.Module);

/**
 * blockHandler
 * @param {Block} block - the block being added or removed from the chain
 * @param {Boolean} add - whether the block is being added or removed
 * @param {Function} callback - call with the leveldb database operations to perform
 */
MyModule.prototype.blockHandler = function(block, add, callback) {
  var transactions = this.db.getTransactionsFromBlock(block);
  // loop through transactions and outputs
  // call the callback with leveldb database operations
  var operations = [];
  if(add) {
    operations.push({
      type: 'put',
      key: 'key',
      value: 'value'
    });
  } else {
    operations.push({
      type: 'del',
      key: 'key'
    });
  }

  // If your function is not asynchronous, it is important to use setImmediate.
  setImmediate(function() {
    callback(null, operations);
  });
};

/**
 * the API methods to expose
 * @return {Array} return array of methods
 */
MyModule.prototype.getAPIMethods = function() {
  return [
    ['getData', this, this.getData, 1]
  ];
};

/**
 * the bus events available for subscription
 * @return {Array} array of events
 */
MyModule.prototype.getPublishEvents = function() {
  return [
    {
      name: 'custom',
      scope: this,
      subscribe: this.subscribeCustom,
      unsubscribe: this.unsubscribeCustom
    }
  ]
};

/**
 * Will keep track of event listeners to later publish and emit events.
 */
MyModule.prototype.subscribeCustom = function(emitter, param) {
  if(!this.subscriptions[param]) {
    this.subscriptions[param] = [];
  }
  this.subscriptions[param].push(emitter);
}

MyModule.prototype.getData = function(arg1, callback) {
  // You can query the data by reading from the leveldb store on db
  this.db.store.get(arg1, callback);
};

module.exports = MyModule;
```

The module can then be used when running a node:

```js
var configuration = {
  datadir: process.env.BITCORENODE_DIR || '~/.bitcoin',
  db: {
    modules: [MyModule]
  }
};

var node = new Node(configuration);

node.on('ready', function() {
  node.getData('key', function(err, value) {
    console.log(err || value);
  });
});
```

Note that if you already have a bitcore-node database, and you want to query data from previous blocks in the blockchain, you will need to reindex. Reindexing right now means deleting your bitcore-node database and resyncing.

## Daemon Documentation

- `daemon.start([options], [callback])` - Start the JavaScript Bitcoin node.
- `daemon.getBlock(blockHash|blockHeight, callback)` - Get any block asynchronously by block hash or height as a node buffer.
- `daemon.getTransaction(txid, blockhash, callback)` - Get any tx asynchronously by reading it from disk.
- `daemon.log(message), daemon.info(message)` - Log to standard output.
- `daemon.error(message)` - Log to stderr.
- `daemon.close([callback])` - Stop the JavaScript bitcoin node safely, the callback will be called when bitcoind is closed. This will also be done automatically on `process.exit`. It also takes the bitcoind node off the libuv event loop. If the daemon object is the only thing on the event loop. Node will simply close.

## Building

There are two main parts of the build, compiling Bitcoin Core and the Node.js bindings. You can run both by using `npm install` and set environment variable, $BITCOINDJS_ENV to 'test' or 'debug'. Both 'test' and 'debug' build libbitcoind with debug symbols whereas 'test' adds wallet capability so that regtest can be used.

### Node.js Bindings

```bash
$ node-gyp rebuild
```

And then with debug:

```bash
$ node-gyp -d rebuild
```

To be able to debug you'll need to have `gdb` and `node` compiled for debugging with gdb using `--gdb` (node_g), and you can then run:

```bash
$ gdb --args node_g path/to/example.js
```

To run mocha from within gdb (notice `_mocha` and not `mocha` so that the tests run in the same process):
```bash
$ gdb --args node /path/to/_mocha -R spec integration/index.js
```

To run integration tests against testnet or livenet data:

```bash
$ cd integration
// modify index.js configuration, and then run mocha
$ mocha -R spec index.js
```

To run the benchmarks (also with livenet or testnet data):

```bash
$ cd benchmarks
$ node index.js
```

### Bitcoin Core

#### Dependencies

Most of all the dependencies for building Bitcoin Core are needed, for more information please see the build notes for [Unix](https://github.com/bitcoin/bitcoin/blob/master/doc/build-unix.md) and [Mac OS X](https://github.com/bitcoin/bitcoin/blob/master/doc/build-osx.md). These dependencies are needed:

- Boost
  - Boost Header Files (`/usr/include/boost`)
  - The Boost header files can be from your distro (like Debian or Ubuntu), just be sure to install the "-dev" versions of Boost (`sudo apt-get install libboost-all-dev`).

- OpenSSL headers and libraries (-lcrypto and -lssl), this is used to compile Bitcoin.

- If target platform is Mac OS X, then OS X >= 10.9, Clang and associated linker.

#### Shared Library Patch

To provide native bindings to JavaScript *(or any other language for that matter)*, Bitcoin code, itself, must be linkable. Currently, Bitcoin Core provides a JSON RPC interface to bitcoind as well as a shared library for script validation *(and hopefully more)* called libbitcoinconsensus. There is a node module, [node-libbitcoinconsensus](https://github.com/bitpay/node-libbitcoinconsensus), that exposes these methods. While these interfaces are useful for several use cases, there are additional use cases that are not fulfilled, and being able to implement customized interfaces is necessary. To be able to do this a few simple changes need to be made to Bitcoin Core to compile as a shared library.

The patch is located at `etc/bitcoin.patch` and adds a configure option `--enable-daemonlib` to compile all object files with `-fPIC` (Position Independent Code - needed to create a shared object), exposes leveldb variables and objects, exposes the threadpool to the bindings, and conditionally includes the main function.

Every effort will be made to ensure that this patch stays up-to-date with the latest release of Bitcoin. At the very least, this project began supporting Bitcoin Core v0.10.2.

#### Building

There is a build script that will download Bitcoin Core v0.10.2 and apply the necessary patch, compile `libbitcoind.{so|dylib}` and copy the artifact into `platform/<os_dir>`. Unix/Linux uses the file extension "so" whereas Mac OSX uses "dylib" *(bitcoind compiled as a shared library)*.

```bash
$ cd /path/to/bitcore-node
$ ./bin/build-libbitcoind
```

The `PATCH_VERSION` file dictates what version/tag the patch goes clean against.

There is a config_options.sh that has the configure options used to build libbitcoind. `make` will then compile `libbitcoind/src/.libs/libbitcoind.{so|dylib}`. This will completely ignore compiling tests, QT object files and the wallet features in `bitcoind/libbitcoind.{so|dylib}`.

Or you can also manually compile using:

configure and make (Linux/Unix)

```bash
$ cd libbitcoind
$ ./configure --enable-tests=no --enable-daemonlib --with-gui=no --without-qt --without-miniupnpc --without-bdb --enable-debug --disable-wallet --without-utils
$ make
```
configure and make (Mac OS X) --note the addition of prefix to the location where the libbitcoind library will be installed.

```bash
$ cd libbitcoind
$ ./configure --enable-tests=no --enable-daemonlib --with-gui=no --without-qt --without-miniupnpc --without-bdb --enable-debug --disable-wallet --without-utils --prefix=<os_dir/lib>
$ make
```
And then copy the files (with Unix/Linux):

```bash
$ cp -P libbitcoind/src/.libs/libbitcoind.so* platform/<os_dir>
```

With Mac OS X:
```bash
$ cp -R libbitcoind/src/.libs/libbitcoind.*dylib platform/osx/lib
```

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore-node/blob/master/LICENSE).

Copyright 2013-2015 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
- bcoin (some code borrowed temporarily): Copyright Fedor Indutny, 2014.
