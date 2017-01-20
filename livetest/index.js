'use strict';

var assert = require('assert');
var async = require('async');
var BitcoreNode = require('../');
var db = require('../lib/services/db');
var config = {
  "network": "livenet",
  "port": 3001,
  "datadir": "/Users/chrisk/.bwdb/",
  "services": [
    {
      "name": "bitcoind",
      "config": {
        "connect": [
          {
            "rpcport": 8332,
            "rpcuser": "bitcoin",
            "rpcpassword": "local321",
            "zmqpubrawtx": "tcp://127.0.0.1:28332"
          }
        ]
      },
      "module": require('../lib/services/bitcoind')
    },
    {
      "name": "db",
      "config": {},
      "module": db
    },
    {
      "name": "transaction",
      "config": {},
      "module": require('../lib/services/transaction')
    },
    {
      "name": "address",
      "config": {},
      "module": require('../lib/services/address')
    },
    {
      "name": "timestamp",
      "config": {},
      "module": require('../lib/services/timestamp')
    }
  ],
  "servicesConfig": {
    "bitcoind": {
      "connect": [
        {
          "rpcport": 8332,
          "rpcuser": "bitcoin",
          "rpcpassword": "local321",
          "zmqpubrawtx": "tcp://127.0.0.1:28332"
        }
      ]
    }
  },
  "path": "/Users/chrisk/source/zzbitcore_node/bitcore-node.json"
}
db.prototype.sync = function(){};
var node = new BitcoreNode.Node(config);
node.start(function(err) {
  if(err) {
    throw err;
  }
  var addresses = [ '1MfDRRVVKXUe5KNVZzu8CBzUZDHTTYZM94' ];
  async.series([function(next) {
    node.services.address.getUnspentOutputs(addresses, false, function(err, results) {
      if(err) {
        throw err;
      }
      console.log(results);
      next();
    });
  }, function(next) {
    node.services.address.getAddressHistory(addresses, false, function(err, results) {
      if(err) {
        return callback(err);
      }
      console.log(results);
      next();
    });
  }], function(err) {
    node.stop(function(err) {
      if(err) {
        return callback(err);
      }
      process.exit(0);
    });
  });

});
