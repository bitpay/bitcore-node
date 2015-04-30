<img width="250" src="http://bitcore.io/css/images/bitcore-node-logo.png"></img>
=======

[![NPM Package](https://img.shields.io/npm/v/bitcore-node.svg?style=flat-square)](https://www.npmjs.org/package/bitcore-node)
[![Build Status](https://img.shields.io/travis/bitpay/bitcore-node.svg?branch=master&style=flat-square)](https://travis-ci.org/bitpay/bitcore-node)
[![Coverage Status](https://img.shields.io/coveralls/bitpay/bitcore-node.svg?style=flat-square)](https://coveralls.io/r/bitpay/bitcore-node)

## Prerequisites

* **Node.js v0.10.0-v0.12.x** - Download and Install [Node.js](http://www.nodejs.org/download/).

* **NPM** - Node.js package manager, should be automatically installed when you get node.js.

* **Fully-synced Bitcoin Core** - Download and Install [Bitcoin Core](http://bitcoin.org/en/download)

`bitcore-node` needs a trusted Bitcoin Core instance to run. It will connect to it
through the RPC API and bitcoin peer-to-peer protocol.

Configure Bitcoin Core to listen to RPC calls and set `txindex` to true.
The easiest way to do this is by copying `./config/bitcoin.conf` to your
bitcoin data directory (usually `~/.bitcoin` on Linux, `%appdata%\Bitcoin\` on Windows,
or `~/Library/Application Support/Bitcoin` on Mac OS X).

Bitcoin Core must be running and fully synced before running `bitcore-node`. We're planning
to remove the need of running Bitcoin Core separately. [More info](https://github.com/bitpay/bitcore-node/issues/57).

## Quick Install
  Check the Prerequisites section above before installing.

  To install `bitcore-node`, clone the main repository:

    $ git clone https://github.com/bitpay/bitcore-node && cd bitcore-node

  Install dependencies:

    $ npm install

  Run the main application:

    $ npm start

  Then open a browser and go to:

    http://localhost:8080

  Please note that the app will need to sync its internal database
  with the blockchain state, which will take some time. You can check
  sync progress at http://localhost:8080/v1/node.


## Configuration

`bitcore-node` is configured using [yaml](http://en.wikipedia.org/wiki/YAML) files.
The application defaults are in the [api/config/](api/config/) folder.

To run the app with different configurations, simply do:
```sh
# to start a testnet instance
NODE_ENV=testnet npm start

# to start a livenet instance
NODE_ENV=livenet npm start

# start a custom configuration instance (will usee foo.yml)
NODE_ENV=foo npm start
$  
```

A sample configuration file would be:

```
# Sample configuration file with defaults for livenet
BitcoreHTTP:
  port: 8080                # http api port
  logging: true             # enables request logging
  BitcoreNode:              
    LevelUp: ./db           # path to database location
    network: livenet        # bitcoin network (livenet, testnet)
    NetworkMonitor:
      host: localhost       # p2p host
      port: 8333            # p2p port
    RPC:
      host: 127.0.0.1       # rpc ip
      port: 8332            # rpc port
      user: user            # rpc username
      pass: password        # rpc password
      protocol: http        #http, https
      #rejectUnauthorized: false
      #disableAgent: true
```

## Synchronization

The initial synchronization process scans the blockchain from the paired
Bitcoin Core node to update addresses and balances. `bitcore-node` needs exactly one
trusted bitcoind node to run.
[There are plans to expand this to more than one](https://github.com/bitpay/bitcore-node/issues/58).
Bitcoin core must have finished downloading the blockchain before running `bitcore-node`.

While `bitcore-node` is synchronizing the website can be accessed (the sync process is embedded in the webserver), but there may be missing data or incorrect balances for addresses. The 'sync' status is shown at the `/api/sync` endpoint.

The blockchain can be read from bitcoind's raw `.dat` files or RPC interface. 
Reading the information from the `.dat` files is much faster so it's the
recommended (and default) alternative. `.dat` files are scanned in the default
location for each platform (for example, `~/.bitcoin` on Linux). In case a
non-standard location is used, it needs to be defined (see the Configuration section).
As of June 2014, using `.dat` files the sync process takes 9 hrs.
for livenet and 30 mins. for testnet.

While synchronizing the blockchain, `bitcore-node` listens for new blocks and
transactions relayed by the bitcoind node. Those are also stored on `bitcore-node`'s database.
In case `bitcore-node` is shutdown for a period of time, restarting it will trigger
a partial (historic) synchronization of the blockchain. Depending on the size of
that synchronization task, a reverse RPC or forward `.dat` syncing strategy will be used.

If bitcoind is shutdown, `bitcore-node` needs to be stopped and restarted
once bitcoind is restarted.

### Syncing old blockchain data manually

  Old blockchain data can be manually synced issuing:

    $ util/sync.js

  Check util/sync.js --help for options, particulary -D to erase the current DB.

  *NOTE*: there is no need to run this manually since the historic synchronization
  is built in into the web application. Running `bitcore-node` normally will trigger
  the historic sync automatically.


### DB storage requirement

To store the blockchain and address related information, LevelDB is used.
Two DBs are created: txs and blocks. By default these are stored on

  ``~/.bitcore-node/``

This can be changed at config/config.js. As of June 2014, storing the livenet blockchain takes ~35GB of disk space (2GB for the testnet).

## Development

To run `bitcore-node` locally for development with gulp:

```$ NODE_ENV=development gulp```

To run the tests

```$ gulp test```


## Caching schema

Since v0.2 a new cache schema has been introduced. Only information from transactions with
BLOCKCHAIN_API_SAFE_CONFIRMATIONS settings will be cached (by default SAFE_CONFIRMATIONS=6). There 
are 3 different caches:
 * Number of confirmations 
 * Transaction output spent/unspent status
 * scriptPubKey for unspent transactions

Cache data is only populated on request, i.e., only after accessing the required data for
the first time, the information is cached, there is not pre-caching procedure.  To ignore 
cache by default, use BLOCKCHAIN_API_IGNORE_CACHE. Also, address related calls support `?noCache=1`
to ignore the cache in a particular API request.

## API

By default, `bitcore-node` provides a REST API at `/api`, but this prefix is configurable from the var `apiPrefix` in the `config.js` file.

The end-points are:


### Block
```
  /api/block/[:hash]
  /api/block/00000000a967199a2fad0877433c93df785a8d8ce062e5f9b451cd1397bdbf62
```
### Transaction
```
  /api/tx/[:txid]
  /api/tx/525de308971eabd941b139f46c7198b5af9479325c2395db7f2fb5ae8562556c
```
### Address
```
  /api/addr/[:addr][?noTxList=1&noCache=1]
  /api/addr/mmvP3mTe53qxHdPqXEvdu8WdC7GfQ2vmx5?noTxList=1
```
### Address Properties
```
  /api/addr/[:addr]/balance
  /api/addr/[:addr]/totalReceived
  /api/addr/[:addr]/totalSent
  /api/addr/[:addr]/unconfirmedBalance
```
The response contains the value in Satoshis.
### Unspent Outputs
```
  /api/addr/[:addr]/utxo[?noCache=1]
```
Sample return:
``` json
[
    {
      address: "n2PuaAguxZqLddRbTnAoAuwKYgN2w2hZk7",
      txid: "dbfdc2a0d22a8282c4e7be0452d595695f3a39173bed4f48e590877382b112fc",
      vout: 0,
      ts: 1401276201,
      scriptPubKey: "76a914e50575162795cd77366fb80d728e3216bd52deac88ac",
      amount: 0.001,
      confirmations: 3
    },
    {
      address: "n2PuaAguxZqLddRbTnAoAuwKYgN2w2hZk7",
      txid: "e2b82af55d64f12fd0dd075d0922ee7d6a300f58fe60a23cbb5831b31d1d58b4",
      vout: 0,
      ts: 1401226410,
      scriptPubKey: "76a914e50575162795cd77366fb80d728e3216bd52deac88ac",
      amount: 0.001,
      confirmation: 6    
      confirmationsFromCache: true,
    }
]
```
Please note that in case confirmations are cached (which happens by default when the number of confirmations is bigger that BLOCKCHAIN_API_SAFE_CONFIRMATIONS) the response will include the pair confirmationsFromCache:true, and confirmations will equal BLOCKCHAIN_API_SAFE_CONFIRMATIONS. See noCache and BLOCKCHAIN_API_IGNORE_CACHE options for details.



### Unspent Outputs for multiple addresses
GET method:
```
  /api/addrs/[:addrs]/utxo
  /api/addrs/2NF2baYuJAkCKo5onjUKEPdARQkZ6SYyKd5,2NAre8sX2povnjy4aeiHKeEh97Qhn97tB1f/utxo
```

POST method:
```
  /api/addrs/utxo
```

POST params:
```
addrs: 2NF2baYuJAkCKo5onjUKEPdARQkZ6SYyKd5,2NAre8sX2povnjy4aeiHKeEh97Qhn97tB1f
```

### Transactions by Block
```
  /api/txs/?block=HASH
  /api/txs/?block=00000000fa6cf7367e50ad14eb0ca4737131f256fc4c5841fd3c3f140140e6b6
```
### Transactions by Address
```
  /api/txs/?address=ADDR
  /api/txs/?address=mmhmMNfBiZZ37g1tgg2t8DDbNoEdqKVxAL
```

### Transactions for multiple addresses
GET method:
```
  /api/addrs/[:addrs]/txs[?from=&to=]
  /api/addrs/2NF2baYuJAkCKo5onjUKEPdARQkZ6SYyKd5,2NAre8sX2povnjy4aeiHKeEh97Qhn97tB1f/txs?from=0&to=20
```

POST method:
```
  /api/addrs/txs
```

POST params:
```
addrs: 2NF2baYuJAkCKo5onjUKEPdARQkZ6SYyKd5,2NAre8sX2povnjy4aeiHKeEh97Qhn97tB1f
from (optional): 0
to (optional): 20
```

Sample output:
```
{ totalItems: 100,
  from: 0,
  to: 20,
  items:
    [ { txid: '3e81723d069b12983b2ef694c9782d32fca26cc978de744acbc32c3d3496e915',
       version: 1,
       locktime: 0,
       vin: [Object],
       vout: [Object],
       blockhash: '00000000011a135e5277f5493c52c66829792392632b8b65429cf07ad3c47a6c',
       confirmations: 109367,
       time: 1393659685,
       blocktime: 1393659685,
       valueOut: 0.3453,
       size: 225,
       firstSeenTs: undefined,
       valueIn: 0.3454,
       fees: 0.0001 },
      { ... },
      { ... },
      ...
      { ... }
    ] 
 }
```

Note: if pagination params are not specified, the result is an array of transactions.


### Transaction broadcasting
POST method:
```
  /api/tx/send
```
POST params:
```
  rawtx: "signed transaction as hex string"

  eg

  rawtx: 01000000017b1eabe0209b1fe794124575ef807057c77ada2138ae4fa8d6c4de0398a14f3f00000000494830450221008949f0cb400094ad2b5eb399d59d01c14d73d8fe6e96df1a7150deb388ab8935022079656090d7f6bac4c9a94e0aad311a4268e082a725f8aeae0573fb12ff866a5f01ffffffff01f0ca052a010000001976a914cbc20a7664f2f69e5355aa427045bc15e7c6c77288ac00000000

```
POST response:
```
  {
      txid: [:txid]
  }

  eg

  {
      txid: "c7736a0a0046d5a8cc61c8c3c2821d4d7517f5de2bc66a966011aaa79965ffba"
  }
```

### Historic blockchain data sync status
```
  /api/sync
```

### Live network p2p data sync status
```
  /api/peer
```

### Status of the bitcoin network
```
  /api/status?q=xxx
```

Where "xxx" can be:

 * getInfo
 * getDifficulty
 * getTxOutSetInfo
 * getBestBlockHash
 * getLastBlockHash

## Web Socket API
The web socket API is served using [socket.io](http://socket.io).

The following are the events published:

'tx': new transaction received from network. This event is published in the 'inv' room. Data will be a app/models/Transaction object.
Sample output:
```
{
  "txid":"00c1b1acb310b87085c7deaaeba478cef5dc9519fab87a4d943ecbb39bd5b053",
  "processed":false
  ...
}
```


'block': new block received from network. This event is published in the 'inv' room. Data will be a app/models/Block object.
Sample output:
```
{
  "hash":"000000004a3d187c430cd6a5e988aca3b19e1f1d1727a50dead6c8ac26899b96",
  "time":1389789343,
  ...
}
```

'<bitcoinAddress>': new transaction concerning <bitcoinAddress> received from network. This event is published in the '<bitcoinAddress>' room.

'status': every 1% increment on the sync task, this event will be triggered. This event is published in the 'sync' room.

Sample output:
```
{
  blocksToSync: 164141,
  syncedBlocks: 475,
  upToExisting: true,
  scanningBackward: true,
  isEndGenesis: true,
  end: "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943",
  isStartGenesis: false,
  start: "000000009f929800556a8f3cfdbe57c187f2f679e351b12f7011bfc276c41b6d"
}
```

### Example Usage

The following html page connects to the socket.io API and listens for new transactions.

html
```
<html>
<body>
  <script src="http://<bitcore-node-server>:<port>/socket.io/socket.io.js"></script>
  <script>
    eventToListenTo = 'tx'
    room = 'inv'

    var socket = io("http://<bitcore-node-server>:<port>/");
    socket.on('connect', function() {
      // Join the room.
      socket.emit('subscribe', room);
    })
    socket.on(eventToListenTo, function(data) {
      console.log("New transaction received: " + data.txid)
    })
  </script>
</body>
</html>
```

## License
(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
