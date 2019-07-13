Bitcore Node
============

A Navcoin full node for building applications and services with Node.js. A node is extensible and can be configured to run additional services. At the minimum a node has an interface to [Navcoin full node](https://github.com/navcoindev/navcoin2) for more advanced address queries. Additional services can be enabled to make a node more useful such as exposing new APIs, running a block explorer and wallet service.

## Install

```bashl
sudo npm install --unsafe-perm -g git://github.com/Encrypt-S/bitcore-node.git
bitcore-node create mynode
cd mynode
bitcore-node start
```

Note: For your convenience, we automate the download and compilation of the navcoind daemon. Upon npm install, the sources will be downloaded and built.

## Installing modules

```bashl
cd mynode
bitcore-node install insight-api
bitcore-node install bitcore-wallet-service
```

## Prerequisites

- GNU/Linux x86_32/x86_64, or OSX 64bit
- Node.js v0.10, v0.12 or v4
- ZeroMQ *(libzmq3-dev for Ubuntu/Debian or zeromq on OSX)*
- ~200GB of disk storage
- ~8GB of RAM

### Installing libzmq3-dev on Debian

Add the following line to /etc/apt/sources.list

```
deb http://http.us.debian.org/debian testing main contrib non-free
```

Then apt-get install libzmq3-dev.

### MongoDB

If MongoDB fails to connect when running `bitcore-node start` try installing it with apt:

```bashl
sudo apt install mongodb-server
```

## Configuration

Bitcore includes a Command Line Interface (CLI) for managing, configuring and interfacing with your Bitcore Node.

```bash
bitcore-node create -d <navcoin-data-dir> mynode
cd mynode
bitcore-node install <service>
bitcore-node install https://github.com/yourname/helloworld
```

This will create a directory with configuration files for your node and install the necessary dependencies. For more information about (and developing) services, please see the [Service Documentation](docs/services.md).

## Add-on Services

There are several add-on services available to extend the functionality of Bitcore:

- [Insight API](https://github.com/bitpay/insight-api)
- [Insight UI](https://github.com/bitpay/insight-ui)
- [Bitcore Wallet Service](https://github.com/bitpay/bitcore-wallet-service)

## Documentation

- [Upgrade Notes](docs/upgrade.md)
- [Services](docs/services.md)
  - [Bitcoind](docs/services/bitcoind.md) - Interface to Bitcoin Core
  - [Web](docs/services/web.md) - Creates an express application over which services can expose their web/API content
- [Development Environment](docs/development.md) - Guide for setting up a development environment
- [Node](docs/node.md) - Details on the node constructor
- [Bus](docs/bus.md) - Overview of the event bus constructor
- [Release Process](docs/release.md) - Information about verifying a release and the release process.

## Contributing

Please send pull requests for bug fixes, code optimization, and ideas for improvement. For more information on how to contribute, please refer to our [CONTRIBUTING](https://github.com/bitpay/bitcore/blob/master/CONTRIBUTING.md) file.

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore-node/blob/master/LICENSE).

Copyright 2013-2015 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
