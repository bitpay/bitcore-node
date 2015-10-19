A Bitcoin full node for building applications and services with Node.js. A node is extensible and can be configured to run additional services. At the minimum a node has native bindings to Bitcoin Core with the [Bitcoin Service](services/bitcoind.md). Additional services can be enabled to make a node more useful such as exposing new APIs, adding new indexes for addresses with the [Address Service](services/address.md), running a block explorer, wallet service, and other customizations.

# Install

```bash
npm install -g bitcore
bitcore start
```

Note: For your convenience, we distribute binaries for x86_64 Linux and x86_64 Mac OS X. Upon npm install, the binaries for your platform will be downloaded. For more detailed installation instructions, or if you want to compile the project yourself, then please see the [Build & Install](build.md) documentation to build the project from source.

# Prerequisites
- Node.js v0.12
- ~100GB of disk storage
- ~4GB of RAM
- Mac OS X >= 10.9, Ubuntu >= 12.04 (libc >= 2.15 and libstdc++ >= 6.0.16)

# Configuration
Bitcore includes a Command Line Interface (CLI) for managing, configuring and interfacing with your Bitcore Node.

```bash
bitcore create -d <bitcoin-data-dir> mynode
cd mynode
bitcore install <service>
bitcore install https://github.com/yourname/helloworld
```

This will create a directory with configuration files for your node and install the necessary dependencies. For more information about (and developing) services, please see the [Service Documentation](services.md).

To start bitcore as a daemon:

```bash
bitcore start --daemon
```

# Add-on Services
There are several add-on services available to extend the functionality of Bitcore Node:
- [Insight API](https://github.com/bitpay/insight-api/tree/v0.3.0)
- [Insight UI](https://github.com/bitpay/insight/tree/v0.3.0)

# Documentation
- [Services](services.md)
  - [Bitcoind](services/bitcoind.md) - Native bindings to Bitcoin Core
  - [Database](services/db.md) - The foundation API methods for getting information about blocks and transactions.
  - [Address](services/address.md) - Adds additional API methods for querying and subscribing to events with bitcoin addresses.
  - [Web](services/web.md) - Creates an express application over which services can expose their web/API content

- [Build & Install](build.md) - How to build and install from source
- [Testing & Development](testing.md) - Developer guide for testing
- [Node](node.md) - Details on the node constructor
- [Bus](bus.md) - Overview of the event bus constructor
- [Errors](errors.md) - Reference for error handling and types
- [Patch](patch.md) - Information about the patch applied to Bitcoin Core
- [Release Process](release.md) - Information about verifying a release and the release process.
