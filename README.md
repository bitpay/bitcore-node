Bitcore Node (BCH)
============

## !! THIS IS STILL IN BETA, Please use with caution and check the open issues before using!!
## Prerequisites

- Bitcoin Cash Full node (local/remote).
  - I used [bitcoin-abc-0.17.2](https://download.bitcoinabc.org/0.17.2/)
- Node.js v8.2.0+
- `build-essential` and `libzmq3-dev`
  - You can use `sudo apt-get install build-essential libzmq3-dev`
- ~200 GB (only for the full blockchain `livenet`/`testnet`, for `regtest` you don't need much)
- ~4GB of RAM

## Install

```bash
git clone -b cash https://github.com/osagga/bitcore-node.git && cd bitcore-node
npm install
./bin/bitcore-node start
```

## Configuration

This Bitcore node will "attach" to a running full node (you need to specify the ip of the full node in the main configuration file `"bitcore-node.json`), **you need to have the Bitcoin Cash node running before starting this node**. I would recommend using the same setting in `bitcoin.conf.sample` to setup the full Bitcoin-Cash node (at least the RPC settings since Bitcore uses the same RPC credentials by default.)

The config file instructs bitcore-node for the following options:
- location of database files (datadir)
- tcp port for web services, if configured (port)
- bitcoin-cash network type (e.g. `mainnet`, `testnet`, `regtest`), (network)
- what services to include (services)
- the services' configuration (servicesConfig)
- ip of the bitcoin cash peer, along with its RPC settings.

## Documentation

- [Services](docs/services.md)
  - [Fee](docs/services/fee.md) - Creates a service to handle fee queries
  - [Header](docs/services/header.md) - Creates a service to handle block headers
  - [Block](docs/services/block.md) - Creates a service to handle blocks
  - [Transaction](docs/services/transaction.md) - Creates a service to handle transactions
  - [Address](docs/services/address.md) - Creates a service to handle addresses
  - [Mempool](docs/services/mempool.md) - Creates a service to handle mempool
  - [Timestamp](docs/services/timestamp.md) - Creates a service to handle timestamp
  - [Db](docs/services/db.md) - Creates a service to handle the database
  - [p2p](docs/services/p2p.md) - Creates a service to handle the peer-to-peer network
  - [Web](docs/services/web.md) - Creates an express application over which services can expose their web/API content
- [Development Environment](docs/development.md) - Guide for setting up a development environment
- [Node](docs/node.md) - Details on the node constructor
- [Bus](docs/bus.md) - Overview of the event bus constructor
- [Release Process](docs/release.md) - Information about verifying a release and the release process.

## License

Code released under [the MIT license](https://github.com/bitpay/bitcore-node/blob/master/LICENSE).

Copyright 2013-2017 BitPay, Inc.

- bitcoin: Copyright (c) 2009-2015 Bitcoin Core Developers (MIT License)
