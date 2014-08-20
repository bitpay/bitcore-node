# bitcoind.js

Bitcoind as a node.js module.

## Building

### bitcoind:

- NOTE (to self): Arch is using bitcoin-daemon 0.9.2.1, the latest boost headers
  in Arch should be correct.

``` bash
$ cd ~/bitcoin
$ git clean -xdf

...

$ git checkout v0.9.2.1
OR:
$ git checkout v0.9.0

...

$ ./autogen.sh

...

$ ./configure --with-incompatible-bdb --prefix=/usr
OR:
$ ./configure --prefix=/usr

...

$ time make
```

### bitcoind.js:

- NOTE: This will eventually try to include our included version of boost.
- NOTE: Rename bitcoind to bitcoind.o to try to statically link it?

``` bash
$ cd ~/work/node_modules/bitcoind.js
$ PYTHON=/usr/bin/python2.7 make gyp
```

## Contribution and License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## License

Copyright (c) 2014, BitPay (MIT License).
