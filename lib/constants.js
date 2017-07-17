'use strict';


module.exports = {
  BITCOIN_GENESIS_HASH: {
    livenet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943', //this is testnet3
    testnet5: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943' //this is testnet5
  },
  DB_PREFIX: new Buffer('ffff', 'hex')
};

