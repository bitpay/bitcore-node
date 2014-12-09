# bitcoind.js

__bitcoind.js__ as a node.js module which dynamically loads a node.js C++
modules which links to libbitcoind.so (bitcoind compiled as a shared library),
making all useful bitcoind functions asynchronous.

## Building

### libbitcoind.so

#### Compiling bitcoind as a library

##### Dependencies

- Boost
  - Bost Header Files (`/usr/include/boost`)
  - NOTE: These are now included in the repo if they're not present.

- Berkeley DB

- LevelDB Header Files (included in bitcoin source repo, leveldb itself
  unnecessary, libbitcoind.so is already linked to them)
  - NOTE: These also are now included in the repo if they're not present.

- Protobuf

- secp256k1

##### Building

``` bash
$ cd ~/node_modules/bitcoind.js
$ ./bin/build-libbitcoind remote
```

NOTE: This script will run automatically on an `npm install`, along with the
compilation below.

`remote` will clone the latest bitcoin upstream, apply a patch to it, compile
libbitcoind.so, and place it in the appropriate directory. The first argument
can also be a bitcoin repo directory you already have on your disk, otherwise
it will check for ~/bitcoin by default.

NOTE: libbitcoind.so is currently unsupported on OSX due to OSX's mess of
header files and libraries. Special magic is required to make this work that
has not been implemented yet. This will only compile on a real unix (linux is
recommended).

###### In the build-libbitcoind.sh script:

`--enable-daemonlib` will compile all object files with `-fPIC` (Position
Independent Code - needed to create a shared object).

`make` will then compile `./src/libbitcoind.so` (with `-shared -fPIC`), linking
to all the freshly compiled PIC object files. This will completely ignore
compiling tests and the QT object files.

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
  console.log('Your Wallet:');
  console.log(bitcoind.wallet.getAccounts());
});

bitcoind.start();
```

``` bash
$ node ./my-example.js
bitcoind.js: status="start_node(): bitcoind opened."
Your Wallet:
{ '':
   { balance: 0,
     addresses:
      [ { address: '16PvEk4NggaCyfR2keZaP9nPufJvDb2ATZ',
          privkeycompressed: true,
          privkey: 'L47MC7gtB5UdWYsmxT6czzGophFm6Zj99PYVQWDNkJG6Mf12GGyi',
          pubkeycompressed: true,
          pubkey: '02bf636e7a3ad48ea2cf0c8dbdf992792e617a4f92f2e161f20f3c038883647f0d' } ] } }
^C
bitcoind.js: stop_node(): bitcoind shutdown.
bitcoind.js: shutting down...
bitcoind.js: shut down.
```


## Documentation

**bitcoind.js** is a node.js module which links to libbitcoind.so (bitcoind
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


#### Wallet Object/Class (Singleton)

##### `Wallet::createAddress(options)`

Create a new address for the global wallet.

##### `Wallet::getAccountAddress(options)`

Get the main address associated with the provided account.

##### `Wallet::setAccount(options)`

Associate account name with address.

##### `Wallet::getAccount(options)`

Get account name by address.

##### `Wallet::sendTo(options)`

Automatically create a transaction and fill/sign it with any available unspent
outputs/inputs and broadcast it.

##### `Wallet::signMessage(options)`

Sign any piece of text using the private key associated with the provided
address.

##### `Wallet::verifyMessage(options)`

Verify any signed piece of text using the public key associated with signing
private key.

##### `Wallet::createMultiSigAddress(options)`

Create a multi-signature for the global wallet.

##### `Wallet::getBalance(options)`

Get the total balance of the global wallet in satoshis.

##### `Wallet::getUnconfirmedBalance(options)`

Get the total unconfirmed balance of the global wallet in satoshis

##### `Wallet::sendFrom(options)`

Automatically create a transaction and fill/sign it with any available unspent
outputs/inputs and broadcast it. This method will also select unspent outputs
from the provided account name to fill the transaction.

##### `Wallet::listTransactions(options)`

List transactions associated with the global wallet - NOT YET IMPLEMENTED.

##### `Wallet::listAccounts(options)`

Return a javascript object containing account names, addresses, public keys,
private keys, balances, and whether the keys are in compressed format.

##### `Wallet::getTransaction(options)`

Return any transaction associated with the global wallet - NOT YET IMPLEMENTED.

##### `Wallet::backup(options)`

Backup wallet.dat to provided path.

##### `Wallet::decrypt(options), Wallet::passphrase(options)`

Temporarily decrypt the wallet using the provided passphrase.

##### `Wallet::passphraseChange(options)`

Change passphrase for the global encrypted wallet.

##### `Wallet::forgetPassphrase(options), Wallet::lock(options)`

Forget the current passphrase so the wallet is once again encrypted and
unusuable for any meaningful purpose.

##### `Wallet::encrypt(options)`

Encrypt the global wallet with the provided passphrase.

##### `Wallet::setTxFee(options)`

The the default transaction fee for the global wallet in satoshis.

##### `Wallet::importKey(options)`

Import a private key to global wallet in the standard bitcoind compressed
format.


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


## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`


## License

- bitcoind.js: Copyright (c) 2014, BitPay (MIT License).
- bitcoin: Copyright (c) 2009-2013 Bitcoin Core Developers (MIT License)
- bcoin (some code borrowed temporarily): Copyright Fedor Indutny, 2014.
