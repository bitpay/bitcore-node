# bitcoind.js

Bitcoind as a node.js module.

## Building

### bitcoind

- NOTE (to self): Arch is using bitcoin-daemon 0.9.2.1, the latest boost headers
  in Arch should be correct.

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

  - Berkeley DB

  - LevelDB Header Files (included in bitcoin source repo, leveldb itself
    unnecessary, libbitcoind.so is already linked to them)

``` bash
# ensure clean up
$ make clean
$ find ~/bitcoin -type f -name '*.o' -or -name '*.so' -print0 | xargs -0 rm -f

# create configure file
$ ./autogen.sh

# configure as a library with -fPIC on all object files
# use --with-incompatible-bdb if necessary
# use --prefix=/usr if necessary
$ ./configure --enable-library --with-incompatible-bdb

# build libbitcoind.so
$ time make library
real    31m33.128s
user    16m23.930s
sys     2m52.310s
```

`--enable-library` will compile all object files with `-fPIC` (Position
Independent Code - needed to create a shared object).

`make library` will then compile `./src/libbitcoind.so` (with `-shared -fPIC`),
linking to all the freshly compiled PIC object files.

Without `--enable-library`, the Makefile with compile bitcoind with -fPIE
(Position Independent for Executable), this allows compiling of bitcoind.

#### Todo

- Find a way to compile bitcoind and libbitcoind.so at the same time without
  recompiling object files each time?

### bitcoind.js:

- NOTE: This will eventually try to include our included version of boost.
- NOTE: Rename bitcoind to bitcoind.o to try to statically link it?

``` bash
$ cd ~/work/node_modules/bitcoind.js
$ BITCOIN_DIR=~/bitcoin BOOST_INCLUDE=/usr/include/boost PYTHON=/usr/bin/python2.7 make
```

#### Running bitcoind.js

You can run bitcoind.js to start downloading the blockchain by doing:

``` bash
$ node example/ &
bitcoind: log pipe opened: 12
bitcoind: status="start_node(): bitcoind opened."
```

However, if you look at the bitcoind log files:

``` bash
$ tail -f ~/.bitcoin/debug.log
connect() to [2001:470:c1f2:3::201]:8333 failed: 101
connect() to [2001:470:6c:778::2]:8333 failed: 101
connect() to [2001:470:c1f2:3::201]:8333 failed: 101
```

Right now, the `connect(3)` call is failing due to some conflict with node or
libuv I'm guessing. This is being investigated.

^C (SIGINT) will call `StartShutdown()` in bitcoind on the node thread pool.

##### Features

bitcoind.js now has access to the wallet:

``` js
console.log(bitcoind.wallet.listAccounts());
...
```

``` bash
$ node example
bitcoind.js: status="start_node(): bitcoind opened."
{ '':
   { balance: 0,
     addresses:
      [ { address: '16PvEk4NggaCyfR2keZaP9nPufJvDb2ATZ',
          privkeycompressed: true,
          privkey: 'L47MC7gtB5UdWYsmxT6czzGophFm6Zj99PYVQWDNkJG6Mf12GGyi',
          pubkeycompressed: true,
          pubkey: '02bf636e7a3ad48ea2cf0c8dbdf992792e617a4f92f2e161f20f3c038883647f0d' } ] } }
bitcoind.js: stop_node(): bitcoind shutdown.
bitcoind.js: shutting down...
bitcoind.js: shut down.
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

Copyright (c) 2014, BitPay (MIT License).
