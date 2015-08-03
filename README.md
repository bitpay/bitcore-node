Bitcore Node
=======

A Node.js module that adds a native interface to Bitcoin Core for querying information about the Bitcoin blockchain. Bindings are linked to Bitcore Core compiled as a shared library.

## Install

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
npm install
```
Note: Please see detailed instructions below for complete build details and dependencies needed for installation.

## Build & Install

There are two main parts of the build, compiling Bitcoin Core and the Node.js bindings.

### Ubuntu 14.04 (Unix/Linux)

If git is not already installed, it can be installed by running:

```bash
sudo apt-get install git
git config --global user.email "you@example.com"
git config --global user.name "Your Name"
```

If Node.js v0.12 isn't installed, it can be installed using "nvm", it can be done by following the installation script at https://github.com/creationix/nvm#install-script and then install version v0.12

```bash
nvm install v0.12
```

To build Bitcoin Core and bindings development packages are needed:

```bash
sudo apt-get install build-essential libtool autotools-dev autoconf pkg-config libssl-dev
```

Clone the bitcore-node repository locally:

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
```

And finally run the build which will take several minutes. A script in the "bin" directory will download Bitcoin Core v0.11, apply a shared library patch (see more info below), and compile the shared library and Node.js bindings, and then copy built artifacts and header files into `platform/ubuntu`. You can start this by running:

```bash
npm install
```
Once everything is built, you can run bitcore-node via:

```bash
npm start
```

This will then start the syncing process for Bitcoin Core and the extended capabilities as provided by the built-in Address Module (details below).


### Mac OS X Yosemite

If Xcode is not already installed, it can be installed via the Mac App Store (will take several minutes). XCode includes "Clang", "git" and other build tools. Once Xcode is installed, you'll then need to install "xcode-select" via running in a terminal and following the prompts:

```bash
xcode-select --install
```

If "Homebrew" is not yet installed, it's needed to install "autoconf" and others. You can install it using the script at http://brew.sh and following the directions at https://github.com/Homebrew/homebrew/blob/master/share/doc/homebrew/Installation.md And then run in a terminal:

```bash
brew install autoconf automake libtool openssl pkg-config
```

If Node.js v0.12 and associated commands "node", "npm" and "nvm" are not already installed, you can use "nvm" by running the script at https://github.com/creationix/nvm#install-script And then run this command to install Node.js v0.12

```bash
nvm install v0.12
```

Clone the bitcore-node repository locally:

```bash
git clone https://github.com/bitpay/bitcore-node.git
cd bitcore-node
```

And finally run the build which will take several minutes. A script in the "bin" directory will download Bitcoin Core v0.11, apply a shared library patch (see more info below), and compile the shared library and Node.js bindings, and then copy built artifacts and header files into `platform/osx`. You can start this by running:

```bash
npm install
```
Once everything is built, you can run bitcore-node via:

```bash
npm start
```

This will then start the syncing process for Bitcoin Core and the extended capabilities as provided by the built-in Address Module (details below).

## Development & Testing

To run all of the JavaScript tests:

```bash
npm run test
```

To run tests against the bindings, as defined in `bindings.gyp` the regtest feature of Bitcoin Core is used, and to enable this feature we currently need to build with the wallet enabled *(not a part of the regular build)*. To do this, export an environment variable and recompile:

```bash
export BITCORENODE_ENV=test
rm -rf platform/<os_name>/*
npm install
```

If you do not already have mocha installed:

```bash
npm install mocha -g
```

To run the integration tests:

```bash
mocha -R spec integration/regtest.js
```

If any changes have been made to the bindings in the "src" directory, manually compile the Node.js bindings, as defined in `bindings.gyp`, you can run (-d for debug):

```bash
$ node-gyp -d rebuild
```

To be able to debug you'll need to have `gdb` and `node` compiled for debugging with gdb using `--gdb` (sometimes called node_g), and you can then run:

```bash
$ gdb --args node examples/node.js
```

To run mocha from within gdb (notice `_mocha` and not `mocha` so that the tests run in the same process):
```bash
$ gdb --args node /path/to/_mocha -R spec integration/regtest.js
```

To run the benchmarks:

```bash
$ cd benchmarks
$ node index.js
```

## Shared Library Patch

To provide native bindings to JavaScript *(or any other language for that matter)*, Bitcoin code, itself, must be linkable. Currently, Bitcoin Core provides a JSON RPC interface to bitcoind as well as a shared library for script validation *(and hopefully more)* called libbitcoinconsensus. There is a node module, [node-libbitcoinconsensus](https://github.com/bitpay/node-libbitcoinconsensus), that exposes these methods. While these interfaces are useful for several use cases, there are additional use cases that are not fulfilled, and being able to implement customized interfaces is necessary. To be able to do this a few simple changes need to be made to Bitcoin Core to compile as a shared library.

The patch is located at `etc/bitcoin.patch` and adds a configure option `--enable-daemonlib` to compile all object files with `-fPIC` (Position Independent Code - needed to create a shared object), exposes leveldb variables and objects, exposes the threadpool to the bindings, and conditionally includes the main function.

Every effort will be made to ensure that this patch stays up-to-date with the latest release of Bitcoin. At the very least, this project began supporting Bitcoin Core v0.11.

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

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore-node/blob/master/LICENSE).

Copyright 2013-2015 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
- bcoin (some code borrowed temporarily): Copyright Fedor Indutny, 2014.
