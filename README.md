# bitcoind.js

A Node.js module that adds a native interface to Bitcoin Core for querying information about the bitcoin blockchain. Bindings are linked to Bitcore Core compiled as a shared library.

## Example Usage

``` js
var bitcoind = require('bitcoind.js')({
  directory: '~/.libbitcoind-example',
  testnet: false,
  rpc: false
});

bitcoind.getBlock(blockHash, function(err, block) {
  // block is a node buffer
}
```

You can log output from the daemon using:

``` bash
$ tail -f ~/.libbitcoind-example/debug.log
```

^C (SIGINT) will call `StartShutdown()` in bitcoind on the node thread pool.

## Documentation

- `Bitcoin::start([options], [callback])` - Start the javascript bitcoin node.
- `Bitcoin::getBlock(blockHash, callback)` - Get any block asynchronously by reading it from disk.
- `Bitcoin::getTransaction(txid, blockhash, callback)` - Get any tx asynchronously by reading it from disk.
- `Bitcoin::log(), Bitcoin::info()` -Log to standard output.
- `Bitcoin::error()` - Log to stderr.
- `Bitcoin::close` - Stop the javascript bitcoin node safely. This will be done automatically on `process.exit` also. It also takes the bitcoin node off the libuv event loop. If the bitcoin object is the only thing on the event loop. Node will simply close.

## Building

There are two main parts of build, compiling Bitcoin Core and the Node.js bindings.

### Node.js Bindings

```bash
$ node-gyp rebuild
```

And then with debug:

```bash
$ node-gyp -d rebuild
```

To be able to debug you'll need to have `gdb` and `node` compiled for debugging, and you can then run:

```bash
$ gdb --args node path/to/example.js
```

### Bitcoin Core

#### Dependencies

All of the dependencies for building Bitcoin Core are needed, for more information please see the build notes for [Unix](https://github.com/bitcoin/bitcoin/blob/master/doc/build-unix.md) and [Mac OS X](https://github.com/bitcoin/bitcoin/blob/master/doc/build-osx.md).

- Boost
  - Boost Header Files (`/usr/include/boost`)
  - The Boost header files can be from your distro (like Debian or Ubuntu), just be sure to install the "-dev" versions of Boost.

- OpenSSL headers and libraries (-lcrypto and -lssl), this is used to compile Bitcoin.

- If target platform is Mac OS X, then OS X >= 10.9, Clang and associated linker.

#### Shared Library Patch

To provide native bindings to JavaScript *(or any other language for that matter)*, Bitcoin code, itself, must be linkable. Currently, Bitcoin Core achieves this by providing an JSON RPC interface to bitcoind as well as a shared library for script validation *(and hopefully more)* called libbitcoinconsensus. There is also a node module, ([node-libbitcoinconsensus](https://github.com/bitpay/node-libbitcoinconsensus), that exposes these methods. While these interfaces are useful for several use cases, there are additional use cases that are not fulfilled, and being able to implement customized interfaces is necessary. To be able to do this a few simple changes that need to be made to Bitcoin Core to compile as a shared library. 

You can view the patch at: `etc/bitcoin.patch`

Every effort will be made to ensure that this patch stays up-to-date with the latest release of Bitcoin. At the very least, this project began supporting Bitcoin Core v0.10.2.

#### Building

There is a build script that will download Bitcoin Core v10.2 and apply the necessary patch (`/etc/bitcoin.patch`), compile `libbitcoind.{so|dylib}`. Unix/Linux use the file extension "so" whereas Mac OSX uses "dylib" *(bitcoind compiled as a shared library)* and copy into `platform/<os_dir>`. *Note:* This script will run automatically with `npm install`.

```bash
$ cd /path/to/bitcoind.js
$ ./bin/build-libbitcoind
```

The first argument can also be a bitcoin repo directory you already have on your disk, otherwise it will check for ~/bitcoin by default. The `PATCH_VERSION` file dictates what version/tag the patch goes clean against.

`--enable-daemonlib` will compile all object files with `-fPIC` (Position Independent Code - needed to create a shared object).

`make` will then compile `./src/libbitcoind.{so|dylib}` (with `-shared -fPIC`), linking to all the freshly compiled PIC object files. This will completely ignore compiling tests, QT object files and the wallet features in bitcoind/libbitcoind.{so|dylib}.

Without `--enable-daemonlib`, the Makefile with compile bitcoind with -fPIE (Position Independent for Executable), this allows compiling of bitcoind.

Or you can also manually compile using:
```bash
$ cd libbitcoind
$ ./configure --enable-tests=no --enable-daemonlib --with-gui=no --without-qt --without-miniupnpc --without-bdb --enable-debug --disable-wallet --without-utils --prefix=
$ make
$ cp src/libs/libbitcoind.so* ../platform/<os_dir>
```

## License

Code released under [the MIT license](https://github.com/bitpay/bitcoind.js/blob/master/LICENSE).

Copyright 2013-2015 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
- bcoin (some code borrowed temporarily): Copyright Fedor Indutny, 2014.
