# bitcoind.js

__bitcoind.js__ as a node.js module which dynamically loads a node.js C++
modules which links to libbitcoind.so (bitcoind compiled as a shared library),
making all useful bitcoind functions asynchronous.

## Building

### bitcoind

Cloning libbitcoind:

``` bash
$ cd ~
$ git clone git@github.com:bitpay/libbitcoind.git bitcoin
$ cd bitcoin
```

This is a fork of bitcoin v0.9.0 right now, but it has the ability to compile
bitcoind as a shared object. This may not be ideal yet.

#### Compiling bticoind as a library

##### Dependencies

- Boost
  - Bost Header Files (`/usr/include/boost`)
  - NOTE: These are now included in the repo if they're not present.

- Berkeley DB

- LevelDB Header Files (included in bitcoin source repo, leveldb itself
  unnecessary, libbitcoind.so is already linked to them)
  - NOTE: These also are now included in the repo if they're not present.


``` bash
# ensure clean up
$ make clean
$ git clean -xdf

# create configure file
$ ./autogen.sh

# configure as a library with -fPIC on all object files
# use --with-incompatible-bdb if necessary
# use --prefix=/usr if necessary
# osx users may have to specify a boost path
$ ./configure --enable-daemonlib --with-incompatible-bdb

# build libbitcoind.so
$ time make
real    31m33.128s
user    16m23.930s
sys     2m52.310s
```

`--enable-daemonlib` will compile all object files with `-fPIC` (Position
Independent Code - needed to create a shared object).

`make` will then compile `./src/libbitcoind.so` (with `-shared -fPIC`), linking
to all the freshly compiled PIC object files. This will completely ignore
compiling tests and the QT object files.

Without `--enable-daemonlib`, the Makefile with compile bitcoind with -fPIE
(Position Independent for Executable), this allows compiling of bitcoind.

### bitcoind.js:

``` bash
$ cd ~/work/node_modules/bitcoind.js
$ BITCOIN_DIR=~/bitcoin BOOST_INCLUDE=/usr/include/boost PYTHON=/usr/bin/python2.7 make
```

#### Running bitcoind.js

You can run bitcoind.js to start downloading the blockchain by doing:

``` bash
$ node example --on-block &
bitcoind: status="start_node(): bitcoind opened."
...
[should see full javascript blocks here]
```

However, if you look at the bitcoind log files:

``` bash
$ tail -f ~/.bitcoin/debug.log
```

^C (SIGINT) will call `StartShutdown()` in bitcoind on the node thread pool.

##### Example Usage

bitcoind.js has direct access to the global wallet:

``` js
var bitcoind = require('bitcoind.js')({
  directory: '~/.libbitcoin-test'
});
bitcoind.on('open', function() {
  console.log(bitcoind.wallet.listAccounts());
});
...
```

``` bash
$ node ./my-example.js
bitcoind.js: status="start_node(): bitcoind opened."
{ '': // Account Name - '' is default
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


### C++ API Structs

#### `async_node_data`

Where the uv async request data resides.

``` c
struct async_node_data {
  std::string err_msg;
  std::string result;
  Persistent<Function> callback;
};
```

#### `async_block_data`

``` c
struct async_block_data {
  std::string err_msg;
  std::string hash;
  CBlock result_block;
  CBlockIndex* result_blockindex;
  Persistent<Function> callback;
};
```

#### `async_tx_data`

``` c
struct async_tx_data {
  std::string err_msg;
  std::string txHash;
  std::string blockHash;
  CTransaction ctx;
  Persistent<Function> callback;
};
```

#### `async_poll_blocks_data`

``` c
struct async_poll_blocks_data {
  std::string err_msg;
  poll_blocks_list *head;
  Persistent<Array> result_array;
  Persistent<Function> callback;
};
```

#### `poll_blocks_list`

A singly linked list containing any polled CBlocks and CBlockIndexes.
Contained by `async_poll_blocks_data` struct.

``` c
typedef struct _poll_blocks_list {
  CBlock cblock;
  CBlockIndex *cblock_index;
  struct _poll_blocks_list *next;
} poll_blocks_list;
```

#### `async_poll_mempool_data`

``` c
struct async_poll_mempool_data {
  std::string err_msg;
  Persistent<Array> result_array;
  Persistent<Function> callback;
};
```

#### `async_broadcast_tx_data`

``` c
struct async_broadcast_tx_data {
  std::string err_msg;
  Persistent<Object> jstx;
  CTransaction ctx;
  std::string tx_hash;
  bool override_fees;
  bool own_only;
  Persistent<Function> callback;
};
```

#### `async_wallet_sendto_data`

``` c
struct async_wallet_sendto_data {
  std::string err_msg;
  std::string tx_hash;
  std::string address;
  int64_t nAmount;
  CWalletTx wtx;
  Persistent<Function> callback;
};
```

#### `async_wallet_sendfrom_data`

``` c
struct async_wallet_sendfrom_data {
  std::string err_msg;
  std::string tx_hash;
  std::string address;
  int64_t nAmount;
  int nMinDepth;
  CWalletTx wtx;
  Persistent<Function> callback;
};
```

#### `async_import_key_data`

``` c
struct async_import_key_data {
  std::string err_msg;
  bool fRescan;
  Persistent<Function> callback;
};
```


### C++ API Functions

#### `StartBitcoind()`

- `bitcoind.start(callback)`
  - Start the bitcoind node with AppInit2() on a separate thread.

#### `async_start_node()`

- Call start_node() and start all our boost threads.

#### `async_start_node_after()`

- Execute our callback.

#### `start_node(void)`

- Start AppInit2() on a separate thread, wait for
  pwalletMain instantiation (and signal() calls).
  Unfortunately, we need to wait for the initialization
  to unhook the signal handlers so we can use them
  from node.js in javascript.

#### `StopBitcoind()`

- bitcoind.stop(callback)

#### `async_stop_node()`

- Call StartShutdown() to join the boost threads, which will call Shutdown()
  and set shutdownComplete to true to notify the main node.js thread.

#### `async_stop_node_after()`

- Execute our callback.

#### `IsStopping()`

- `bitcoind.stopping()`
  - Check whether bitcoind is in the process of shutting down. This is polled
    from javascript.

#### `IsStopped()`

- `bitcoind.stopped()`
  - Check whether bitcoind has shutdown completely. This will be polled by
    javascript to check whether the libuv event loop is safe to stop.

#### `GetBlock()`

- `bitcoind.getBlock(blockHash, callback)`
  - Read any block from disk asynchronously.

#### `GetTx()`

- `bitcoind.getTx(txHash, [blockHash], callback)`
  - Read any transaction from disk asynchronously.

#### `PollBlocks()`

- `bitcoind.pollBlocks(callback)`
  - Poll for new blocks on the chain. This is necessary since we have no way of
    hooking in to AcceptBlock(). Instead, we constant check for new blocks using
    a SetTimeout() within node.js.
  - Creating a linked list of all blocks within the work function is necessary
    due to doing v8 things within the libuv thread pool will cause a segfault.
    Since this reads full blocks, obviously it will poll for transactions which
    have already been included in blocks as well.

#### `PollMempool()`

- `bitcoind.pollMempool(callback)`
  - This will poll for any transactions in the mempool. i.e. Transactions which
    have not been included in blocks yet. This is not technically necessary to
    be done asynchronously since there are no real blocking calls done here, but
    we will leave the async function here as a placeholder in case we're wrong.

#### `BroadcastTx()`
- `bitcoind.broadcastTx(tx, override_fees, own_only, callback)`
  - Broadcast a raw transaction. This can be used to relay transaction received
    or to broadcast one's own transaction.

#### `VerifyBlock()`
- `bitcoindjs.verifyBlock(block)`
  - This will verify the authenticity of a block (merkleRoot, etc)
    using the internal bitcoind functions.

#### `VerifyTransaction()`

- `bitcoindjs.verifyTransaction(tx)`
  - This will verify a transaction, ensuring it is signed properly using the
    internal bitcoind functions.

#### `FillTransaction()`

- `bitcoindjs.fillTransaction(tx, options)`
  - This will fill a javascript transaction object with the proper available
    unpsent outputs as inputs and sign them using internal bitcoind functions.

#### `GetBlockHex()`
- `bitcoindjs.getBlockHex(callback)`
  - This will return the hex value as well as hash of a javascript block object
    (after being converted to a CBlock).

#### `GetTxHex()`

- `bitcoindjs.getTxHex(tx)`
  - This will return the hex value and hash for any tx, converting a js tx
    object to a CTransaction.

#### `BlockFromHex()`

- `bitcoindjs.blockFromHex(hex)`
  - Create a javascript block from a hex string.

#### `TxFromHex()`

- `bitcoindjs.txFromHex(hex)`
  - Create a javascript tx from a hex string.

#### `WalletNewAddress()`

- `bitcoindjs.walletNewAddress(options)`
  - Create a new address in the global pwalletMain.

#### `GetAccountAddress(strAccount, bForceNew)`

- `CBitcoinAddress GetAccountAddress(std::string strAccount, bool bForceNew)`
  - NOTE: This function was ripped out of the bitcoin core source. It needed to
    be modified to fit v8's error handling.

#### `WalletGetAccountAddress()`

- `bitcoindjs.walletGetAccountAddress(options)`
  - Return the address tied to a specific account name.

#### `WalletSetAccount()`

- `bitcoindjs.walletSetAccount(options)`
  - Return a new address if the account does not exist, or tie an account to an
    address.

#### `WalletGetAccount()`

- `bitcoindjs.walletGetAccount(options)`
  - Get an account name based on address.

#### `WalletSendTo()`

- `bitcoindjs.walletSendTo(options)`
  - Send bitcoin to an address, automatically creating the transaction based on
    availing unspent outputs.

#### `WalletSignMessage()`

- `bitcoindjs.walletSignMessage(options)`
  - Sign any piece of text using a private key tied to an address.

#### `WalletVerifyMessage()`

- `bitcoindjs.walletVerifyMessage(options)`
  - Verify a signed message using any address' public key.

#### `WalletCreateMultiSigAddress()`

- `bitcoindjs.walletCreateMultiSigAddress(options)`
  - Create a multisig address for the global wallet.

#### `WalletGetBalance()`

- `bitcoindjs.walletGetBalance(options)`
  - Get total balance of global wallet in satoshies in a javascript Number (up
    to 64 bits, only 32 if bitwise ops or floating point are used unfortunately.
    Obviously floating point is not necessary for satoshies).

#### `WalletGetUnconfirmedBalance()`

- `bitcoindjs.walletGetUnconfirmedBalance(options)`
  - Returns the unconfirmed balance in satoshies (including the transactions
    that have not yet been included in any block).

#### `WalletSendFrom()`

- `bitcoindjs.walletSendFrom(options)`
  - Send bitcoin to a particular address from a particular owned account name.
    This once again automatically creates and signs a transaction based on any
    unspent outputs available.

#### `WalletListTransactions()`

- `bitcoindjs.walletListTransactions(options)`
  - List all transactions pertaining to any owned addreses. NOT YET IMPLEMENTED>

#### `WalletListAccounts()`

- `bitcoindjs.walletListAccounts(options)`
  - This will list all accounts, addresses, balanced, private keys, public keys,
    and whether these keys are in compressed format. TODO: Only output private
    keys if wallet is decrypted.

#### `WalletGetTransaction()`

- `bitcoindjs.walletGetTransaction(options)`
  - Get any transaction pertaining to any owned addresses. NOT YET IMPLEMENTED.

#### `WalletBackup()`

- `bitcoindjs.walletBackup(options)`
  - Backup the bdb wallet.dat to a particular location on filesystem.

#### `WalletPassphrase()`

- `bitcoindjs.walletPassphrase(options)`
  - Unlock wallet if encrypted already.

#### `WalletPassphraseChange()`

- `bitcoindjs.walletPassphraseChange(options)`
  - Change the current passphrase for the encrypted wallet.

#### `WalletLock()`

- `bitcoindjs.walletLock(options)`
  - Forget the encrypted wallet passphrase and lock the wallet once again.

#### `WalletEncrypt()`

- `bitcoindjs.walletEncrypt(options)`
  - Encrypt the global wallet with a particular passphrase. Requires restarted
    because Berkeley DB is bad.

#### `WalletSetTxFee()`

- `bitcoindjs.walletSetTxFee(options)`
  - Set default global wallet transaction fee internally.

#### `WalletImportKey()`

- `bitcoindjs.walletImportKey(options)`
  - Import private key into global wallet using standard compressed bitcoind
    format.

#### Conversions

- `cblock_to_jsblock(cblock, cblock_index, jsblock)`
- `ctx_to_jstx(ctx, block_hash, jstx)`
- `jsblock_to_cblock(jsblock, cblock)`
- `jstx_to_ctx(jstx, ctx)`

These functions, only callable from C++, are used to convert javascript blocks
and tx objects to bitcoin block and tx objects (CBlocks and CTransactions), and
vice versa.

NOTE: For whatever reason when converting a jstx to a CTransaction via setting
CTransaction properties, the binary output of a jstx is not the same as what
went in. It is unknow why this occurs. For now we are are using a workaround by
carrying the original hex value on the object which is changed when the tx is
changed.

#### `Init()`

Initialize the singleton object known as bitcoindjs. Required by every node.js
C++ module.


### Javascript API

#### Bitcoin Object/Class

Bitcoind in javascript. Right now, only one object can be instantiated.

##### `Bitcoin::start(callback)`

Start the javascript bitcoin node.

##### `Bitcoin::_pollBlocks()`

Internally poll for blocks using setTimeout. Private.

##### `Bitcoin::_pollMempool()`

Internally poll for mempool txs that have not been included in blocks yet.
Private.

##### `Bitcoin::getBlock(blockHash, callback)`

Get any block asynchronously by reading it from disk.

##### `Bitcoin::getTx(txHash, blockHash, callback)`

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
