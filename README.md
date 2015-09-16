Bitcore Node
============

A Bitcoin full node for building applications and services with Node.js. A node is extensible and can be configured to run additional services. At the minimum a node has native bindings to Bitcoin Core with the [Bitcoin Service](docs/services/bitcoind.md). Additional services can be enabled to make a node more useful such as exposing new APIs, adding new indexes for addresses with the [Address Service](docs/services/address.md), running a block explorer, wallet service, and other customizations.

## Install

```bash
npm install -g bitcore-node@0.2.0-beta.X
bitcore-node start
```

Note: For your convenience, we distribute binaries for x86_64 Linux and x86_64 Mac OS X. Upon npm install, the binaries for your platform will be downloaded. For more detailed installation instructions, or if you want to compile the project yourself, then please see the [Build & Install](docs/build.md) documentation to build the project from source.

## Configuration

Bitcore Node includes a Command Line Interface (CLI) for managing, configuring and interfacing with your Bitcore Node.

```bash
bitcore-node create -d <bitcoin-data-dir> mynode "My Node"
cd mynode
bitcore-node add <service>
bitcore-node add https://github.com/yourname/helloworld
```

This will create a directory with configuration files for your node and install the necessary dependencies. For more information about (and developing) services, please see the [Service Documentation](docs/services.md).

To start bitcore-node as a daemon:

```bash
bitcore-node start --daemon
```

## Documentation

- [Services](docs/services.md)
  - [Bitcoind](docs/services/bitcoind.md) - Native bindings to Bitcoin Core
  - [Database](docs/services/db.md) - The foundation API methods for getting information about blocks and transactions.
  - [Address](docs/services/address.md) - Adds additional API methods for querying and subscribing to events with bitcoin addresses.
  - [Web](docs/services/web.md) - Creates an express application over which services can expose their web/API content
- [Build & Install](docs/build.md) - How to build and install from source
- [Testing & Development](docs/testing.md) - Developer guide for testing
- [Node](docs/node.md) - Details on the node constructor
- [Bus](docs/bus.md) - Overview of the event bus constructor
- [Errors](docs/errors.md) - Reference for error handling and types
- [Patch](docs/patch.md) - Information about the patch applied to Bitcoin Core
- [Release Process](docs/release.md) - Information about verifying a release and the release process.

## Contributing

Please send pull requests for bug fixes, code optimization, and ideas for improvement. For more information on how to contribute, please refer to our [CONTRIBUTING](https://github.com/bitpay/bitcore/blob/master/CONTRIBUTING.md) file.

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore-node/blob/master/LICENSE).

Copyright 2013-2015 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
