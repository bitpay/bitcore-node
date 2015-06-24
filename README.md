# bitcoind.js

__bitcoind.js__ as a node.js module which dynamically loads a node.js C++
modules which links to libbitcoind.{so|dylib}. Unix/Linux use the file extension "so" whereas Mac OSX uses "dylib" (bitcoind compiled as a shared library),
making all useful bitcoind functions asynchronous (with the exception of the wallet functionality).

## Building

### libbitcoind.{so|dylib}

#### Compiling bitcoind as a library

##### Dependencies

- Boost
  - Bost Header Files (`/usr/include/boost`)
  - NOTE: These are now included in the repo if they're not present.

- secp256k1

- OpenSSL headers and libraries (-lcrypto and -lssl)

- If target platform is Mac OS X, then OS X >= 10.9, Clang and associated linker.

##### Building

``` bash
$ cd ~/node_modules/bitcoind.js
$ ./bin/build-libbitcoind
```

NOTE: This script will run automatically on an `npm install`, along with the
compilation below.

The first argument can also be a bitcoin repo directory you already have on your disk, otherwise
it will check for ~/bitcoin by default. The `PATCH_VERSION` file dictates what version/tag the patch goes clean against.


###### In the build-libbitcoind.sh script:

`--enable-daemonlib` will compile all object files with `-fPIC` (Position
Independent Code - needed to create a shared object).

`make` will then compile `./src/libbitcoind.{so|dylib}` (with `-shared -fPIC`), linking
to all the freshly compiled PIC object files. This will completely ignore
compiling tests, QT object files and the wallet features in bitcoind/libbitcoind.{so|dylib}.

Without `--enable-daemonlib`, the Makefile with compile bitcoind with -fPIE
(Position Independent for Executable), this allows compiling of bitcoind.

### bitcoind.js

``` bash
$ cd ~/node_modules/bitcoind.js
$ BITCOIN_DIR=~/libbitcoind BOOST_INCLUDE=/usr/include/boost PYTHON=/usr/bin/python2.7 make
```

#### Running bitcoind.js

You can run bitcoind.js to start downloading the blockchain by doing:

``` bash
$ node example --on-block &
bitcoind: status="start_node(): bitcoind opened."
...
[should see full javascript blocks here]
```

You can also look at the blocks come in through the bitcoind log file:

``` bash
$ tail -f ~/.libbitcoind-example/debug.log
```

^C (SIGINT) will call `StartShutdown()` in bitcoind on the node thread pool.

##### Example Usage

bitcoind.js has direct access to the global wallet:

``` js
var bitcoind = require('bitcoind.js')({
  directory: '~/.libbitcoind-example',
  testnet: false,
  rpc: false
});

bitcoind.on('block', function(block) {
  console.log('Found Block:');
  console.log(block);
});

bitcoind.on('addr', function(addr) {
  console.log('Found more peers to connect to:');
  console.log(addr);
});

bitcoind.on('open', function() {
  console.log('Whatever you want from the open signal');
});

bitcoind.start();
```

``` bash
$ node ./my-example.js
bitcoind.js: status="start_node(): bitcoind opened."
^C
bitcoind.js: stop_node(): bitcoind shutdown.
bitcoind.js: shutting down...
bitcoind.js: shut down.
```


## Documentation

**bitcoind.js** is a node.js module which links to libbitcoind.{so|dylib} (bitcoind
complied as a shared library).

### Javascript API

#### Bitcoin Object/Class

Bitcoind in javascript. Right now, only one object can be instantiated.

##### `Bitcoin::start([options], [callback])`

Start the javascript bitcoin node.

##### `Bitcoin::getBlock(blockHash, callback)`

Get any block asynchronously by reading it from disk.

##### `Bitcoin::getTransaction(txid, blockhash, callback)`

Get any tx asynchronously by reading it from disk.

##### `Bitcoin::log(), Bitcoin::info()`

Log to standard output.

##### `Bitcoin::error()`

Log to stderr.

##### `Bitcoin::stop, Bitcoin::close(callback)`

Stop the javascript bitcoin node safely. This will be done automatically on
`process.exit` also. It also takes the bitcoin node off the libuv event loop.
If the bitcoin object is the only thing on the event loop. Node will simply
close.


##### Bitcoin Object Events

Note: Any event that requires polling will only start the polling once the
event is bound.

###### `open(bitcoind)`

bitcoind has opened and loaded the blockchain.

###### `close(bitcoind)`

bitcoind has shutdown.

###### `block(block)`

A block has been received an accepted by bitcoind.

###### `tx(tx)`

A confirmed or unconfirmed transaction has been received by bitcoind.

###### `mptx(tx)`

A tx from the mempool has been addded. Most likely not included in a block yet.


#### Block Object

A block (CBlock) represented in javascript. It is a full block containing all
transactions in `block.tx`.

##### `Block::_blockFlag`

Internal non-enumerable property to check whether the object is a block.

##### `Block.isBlock(block)`

Static method to check whether object is a block.

##### `Block.fromHex(hex)`

Create a js block from a hex string.

##### `Block::getHash(enc)`

Get the block's hash. Return the correct encoding. `hex` is most likely what
you want. If no encoding is provided, a buffer will be returned.

##### `Block::verify()`

Verify whether the block is valid.

##### `Block::toHex()`

Convert the block to a hex string.

##### `Block.toHex(block)`

Static method to convert any block-like object to a hex string.

##### `Block::toBinary()`

Convert the block to a binary buffer.

##### `Block.toBinary(block)`

Static method to convert a block-like object to a hex string.


#### Transaction Object/Class

##### `Transaction::_txFlag`

Internal non-enumerable property to check whether the object is a transaction.

##### `Transaction.isTransaction(tx), Transaction.isTx(tx)`

Static method to check whether object is a transaction.

##### `Transaction.fromHex(hex)`

Create a js transaction from a hex string.

##### `Transaction::verify()`

Verify whether the transaction is valid.

##### `Transaction::sign(), Transaction::fill(options)`

Fill the raw transaction with available unspent outputs and sign them.

##### `Transaction.sign(tx, options), Transaction.fill(tx, options)`

Static method to fill a tx-like object.

##### `Transaction::getHash(enc)`

Get the hash of a Transaction object. Encoding is usually `hex`. If no encoding
is provided, a Buffer will be returned.

##### `Transaction::isCoinbase()`

Check whether the Transaction is a coinbase tx.

##### `Transaction::toHex()`

Convert the transaction to a hex string.

##### `Transaction.toHex(tx)`

Static method to convert a transaction-like object to a hex string.

##### `Transaction::toBinary()`

Convert the transaction to a binary buffer.

##### `Transaction.toBinary(tx)`

Static method to convert a transaction-like object to a binary buffer.

##### `Transaction::broadcast(options, callback)`

Broadcast a raw transaction that has not been included in a block yet. This can
be your own transaction or a transaction relayed to you.

##### `Transaction.broadcast(tx, options, callback)`

Static method to broadcast a transaction.

#### Utils Object (Singleton)

##### `utils.forEach(obj, iter, done)`

Asynchronous parallel forEach function.

##### `utils.NOOP()`

A simple NOP function.


#### Exposed Objects

NOTE: All exposed objects will also be exposed on any instantiated `Bitcoin` object.

##### `bitcoin.Bitcoin, bitcoin.bitcoin, bitcoin.bitcoind`

The bitcoin object.

##### `bitcoin.native, bitcoin.bitcoindjs`

The native C++ bitcoindjs object.

##### `bitcoin.Block, bitcoin.block`

The bitcoind.js Block object.

##### `bitcoin.Transaction, bitcoin.transaction, bitcoin.tx`

The bitcoind.js Transaction object.

##### `bitcoin.Wallet, bitcoin.wallet`

The bitcoind.js Wallet singleton.

##### `bitcoin.utils`

The bitcoind.js utils object.

## Discussion about the patch to Bitcoin to allow the shared library creation

To provide native bindings to JavaScript (or any other language for that matter), Bitcoin code, itself, must be linkable. Currently, Bitcoind achieves this by providing an JSON RPC interface to bitcoind. The major drawbacks to this interface are:

1. JSON RPC interfaces are much slower than linking natively to the C++ code.
2. There can be errors in the interface that prevent clients from using bitcoind's functionality.
3. Functionality can be limited or otherwise unavailable to clients through this interface.

Linking C++ binding code directly to bitcoind can mitigate all of the above disadvantage, but has its own disadavantages:

1. The original authors are not explicitly (or implicitly) providing ANY API support to the C++ bindings written here. This means that in subsequent releases of bitcoind, the bindings could fail and this project's authors will need to update the bindings retroactively.
2. As such, there is likely a lag in support for newer versions of bitcoind.

Due to the pros and cons listed above. The patch to Bitcoin will not be merged by the core devs due to the attitude that the cons outweigh the pros. Every effort will be made to ensure that this project stays up-to-date with the latest release of Bitcoin. At the very least, this project began supporting Bitcoin v0.10.2.

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`


## License

- bitcoind.js: Copyright (c) 2015, BitPay (MIT License).
- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
- bcoin (some code borrowed temporarily): Copyright Fedor Indutny, 2014.
