#!/usr/bin/env node

/**
 * bitcoind.js example
 */

process.title = 'bitcoind.js';

var util = require('util');
var fs = require('fs');
var argv = require('optimist').argv;
var rimraf = require('rimraf');
var assert = require('assert');

/**
 * bitcoind
 */

if (fs.existsSync(process.env.HOME + '/.libbitcoind-example')) {
  rimraf.sync(process.env.HOME + '/.libbitcoind-example');
}

var bitcoind = require('../')({
  directory: '~/.libbitcoind-example'
});

var genesisBlock = '0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
var genesisTx = '0x4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

var testBlock = ''
  + '0100000090f0a9f110702f808219ebea1173056042a714bad51b916cb6800000000000'
  + '005275289558f51c9966699404ae2294730c3c9f9bda53523ce50e9b95e558da2fdb26'
  + '1b4d4c86041b1ab1bf9309010000000100000000000000000000000000000000000000'
  + '00000000000000000000000000ffffffff07044c86041b0146ffffffff0100f2052a01'
  + '000000434104e18f7afbe4721580e81e8414fc8c24d7cfacf254bb5c7b949450c3e997'
  + 'c2dc1242487a8169507b631eb3771f2b425483fb13102c4eb5d858eef260fe70fbfae0'
  + 'ac00000000010000000196608ccbafa16abada902780da4dc35dafd7af05fa0da08cf8'
  + '33575f8cf9e836000000004a493046022100dab24889213caf43ae6adc41cf1c9396c0'
  + '8240c199f5225acf45416330fd7dbd022100fe37900e0644bf574493a07fc5edba06db'
  + 'c07c311b947520c2d514bc5725dcb401ffffffff0100f2052a010000001976a914f15d'
  + '1921f52e4007b146dfa60f369ed2fc393ce288ac000000000100000001fb766c128845'
  + '8c2bafcfec81e48b24d98ec706de6b8af7c4e3c29419bfacb56d000000008c49304602'
  + '2100f268ba165ce0ad2e6d93f089cfcd3785de5c963bb5ea6b8c1b23f1ce3e517b9f02'
  + '2100da7c0f21adc6c401887f2bfd1922f11d76159cbc597fbd756a23dcbb00f4d72901'
  + '41042b4e8625a96127826915a5b109852636ad0da753c9e1d5606a50480cd0c40f1f8b'
  + '8d898235e571fe9357d9ec842bc4bba1827daaf4de06d71844d0057707966affffffff'
  + '0280969800000000001976a9146963907531db72d0ed1a0cfb471ccb63923446f388ac'
  + '80d6e34c000000001976a914f0688ba1c0d1ce182c7af6741e02658c7d4dfcd388ac00'
  + '0000000100000002c40297f730dd7b5a99567eb8d27b78758f607507c52292d02d4031'
  + '895b52f2ff010000008b483045022100f7edfd4b0aac404e5bab4fd3889e0c6c41aa8d'
  + '0e6fa122316f68eddd0a65013902205b09cc8b2d56e1cd1f7f2fafd60a129ed94504c4'
  + 'ac7bdc67b56fe67512658b3e014104732012cb962afa90d31b25d8fb0e32c94e513ab7'
  + 'a17805c14ca4c3423e18b4fb5d0e676841733cb83abaf975845c9f6f2a8097b7d04f49'
  + '08b18368d6fc2d68ecffffffffca5065ff9617cbcba45eb23726df6498a9b9cafed4f5'
  + '4cbab9d227b0035ddefb000000008a473044022068010362a13c7f9919fa832b2dee4e'
  + '788f61f6f5d344a7c2a0da6ae740605658022006d1af525b9a14a35c003b78b72bd597'
  + '38cd676f845d1ff3fc25049e01003614014104732012cb962afa90d31b25d8fb0e32c9'
  + '4e513ab7a17805c14ca4c3423e18b4fb5d0e676841733cb83abaf975845c9f6f2a8097'
  + 'b7d04f4908b18368d6fc2d68ecffffffff01001ec4110200000043410469ab4181eceb'
  + '28985b9b4e895c13fa5e68d85761b7eee311db5addef76fa8621865134a221bd01f28e'
  + 'c9999ee3e021e60766e9d1f3458c115fb28650605f11c9ac000000000100000001cdaf'
  + '2f758e91c514655e2dc50633d1e4c84989f8aa90a0dbc883f0d23ed5c2fa010000008b'
  + '48304502207ab51be6f12a1962ba0aaaf24a20e0b69b27a94fac5adf45aa7d2d18ffd9'
  + '236102210086ae728b370e5329eead9accd880d0cb070aea0c96255fae6c4f1ddcce1f'
  + 'd56e014104462e76fd4067b3a0aa42070082dcb0bf2f388b6495cf33d789904f07d0f5'
  + '5c40fbd4b82963c69b3dc31895d0c772c812b1d5fbcade15312ef1c0e8ebbb12dcd4ff'
  + 'ffffff02404b4c00000000001976a9142b6ba7c9d796b75eef7942fc9288edd37c32f5'
  + 'c388ac002d3101000000001976a9141befba0cdc1ad56529371864d9f6cb042faa06b5'
  + '88ac000000000100000001b4a47603e71b61bc3326efd90111bf02d2f549b067f4c4a8'
  + 'fa183b57a0f800cb010000008a4730440220177c37f9a505c3f1a1f0ce2da777c339bd'
  + '8339ffa02c7cb41f0a5804f473c9230220585b25a2ee80eb59292e52b987dad92acb0c'
  + '64eced92ed9ee105ad153cdb12d001410443bd44f683467e549dae7d20d1d79cbdb6df'
  + '985c6e9c029c8d0c6cb46cc1a4d3cf7923c5021b27f7a0b562ada113bc85d5fda5a1b4'
  + '1e87fe6e8802817cf69996ffffffff0280651406000000001976a9145505614859643a'
  + 'b7b547cd7f1f5e7e2a12322d3788ac00aa0271000000001976a914ea4720a7a52fc166'
  + 'c55ff2298e07baf70ae67e1b88ac00000000010000000586c62cd602d219bb60edb14a'
  + '3e204de0705176f9022fe49a538054fb14abb49e010000008c493046022100f2bc2aba'
  + '2534becbdf062eb993853a42bbbc282083d0daf9b4b585bd401aa8c9022100b1d7fd7e'
  + 'e0b95600db8535bbf331b19eed8d961f7a8e54159c53675d5f69df8c014104462e76fd'
  + '4067b3a0aa42070082dcb0bf2f388b6495cf33d789904f07d0f55c40fbd4b82963c69b'
  + '3dc31895d0c772c812b1d5fbcade15312ef1c0e8ebbb12dcd4ffffffff03ad0e58ccda'
  + 'c3df9dc28a218bcf6f1997b0a93306faaa4b3a28ae83447b2179010000008b48304502'
  + '2100be12b2937179da88599e27bb31c3525097a07cdb52422d165b3ca2f2020ffcf702'
  + '200971b51f853a53d644ebae9ec8f3512e442b1bcb6c315a5b491d119d10624c830141'
  + '04462e76fd4067b3a0aa42070082dcb0bf2f388b6495cf33d789904f07d0f55c40fbd4'
  + 'b82963c69b3dc31895d0c772c812b1d5fbcade15312ef1c0e8ebbb12dcd4ffffffff2a'
  + 'cfcab629bbc8685792603762c921580030ba144af553d271716a95089e107b01000000'
  + '8b483045022100fa579a840ac258871365dd48cd7552f96c8eea69bd00d84f05b283a0'
  + 'dab311e102207e3c0ee9234814cfbb1b659b83671618f45abc1326b9edcc77d552a4f2'
  + 'a805c0014104462e76fd4067b3a0aa42070082dcb0bf2f388b6495cf33d789904f07d0'
  + 'f55c40fbd4b82963c69b3dc31895d0c772c812b1d5fbcade15312ef1c0e8ebbb12dcd4'
  + 'ffffffffdcdc6023bbc9944a658ddc588e61eacb737ddf0a3cd24f113b5a8634c517fc'
  + 'd2000000008b4830450221008d6df731df5d32267954bd7d2dda2302b74c6c2a6aa5c0'
  + 'ca64ecbabc1af03c75022010e55c571d65da7701ae2da1956c442df81bbf076cdbac25'
  + '133f99d98a9ed34c014104462e76fd4067b3a0aa42070082dcb0bf2f388b6495cf33d7'
  + '89904f07d0f55c40fbd4b82963c69b3dc31895d0c772c812b1d5fbcade15312ef1c0e8'
  + 'ebbb12dcd4ffffffffe15557cd5ce258f479dfd6dc6514edf6d7ed5b21fcfa4a038fd6'
  + '9f06b83ac76e010000008b483045022023b3e0ab071eb11de2eb1cc3a67261b866f86b'
  + 'f6867d4558165f7c8c8aca2d86022100dc6e1f53a91de3efe8f63512850811f26284b6'
  + '2f850c70ca73ed5de8771fb451014104462e76fd4067b3a0aa42070082dcb0bf2f388b'
  + '6495cf33d789904f07d0f55c40fbd4b82963c69b3dc31895d0c772c812b1d5fbcade15'
  + '312ef1c0e8ebbb12dcd4ffffffff01404b4c00000000001976a9142b6ba7c9d796b75e'
  + 'ef7942fc9288edd37c32f5c388ac00000000010000000166d7577163c932b4f9690ca6'
  + 'a80b6e4eb001f0a2fa9023df5595602aae96ed8d000000008a4730440220262b425463'
  + '02dfb654a229cefc86432b89628ff259dc87edd1154535b16a67e102207b4634c020a9'
  + '7c3e7bbd0d4d19da6aa2269ad9dded4026e896b213d73ca4b63f014104979b82d02226'
  + 'b3a4597523845754d44f13639e3bf2df5e82c6aab2bdc79687368b01b1ab8b19875ae3'
  + 'c90d661a3d0a33161dab29934edeb36aa01976be3baf8affffffff02404b4c00000000'
  + '001976a9144854e695a02af0aeacb823ccbc272134561e0a1688ac40420f0000000000'
  + '1976a914abee93376d6b37b5c2940655a6fcaf1c8e74237988ac000000000100000001'
  + '4e3f8ef2e91349a9059cb4f01e54ab2597c1387161d3da89919f7ea6acdbb371010000'
  + '008c49304602210081f3183471a5ca22307c0800226f3ef9c353069e0773ac76bb5806'
  + '54d56aa523022100d4c56465bdc069060846f4fbf2f6b20520b2a80b08b168b31e66dd'
  + 'b9c694e240014104976c79848e18251612f8940875b2b08d06e6dc73b9840e8860c066'
  + 'b7e87432c477e9a59a453e71e6d76d5fe34058b800a098fc1740ce3012e8fc8a00c96a'
  + 'f966ffffffff02c0e1e400000000001976a9144134e75a6fcb6042034aab5e18570cf1'
  + 'f844f54788ac404b4c00000000001976a9142b6ba7c9d796b75eef7942fc9288edd37c'
  + '32f5c388ac00000000';

var testTx = ''
  + '01000000010b26e9b7735eb6aabdf358bab62f9816a21ba9ebdb719d5299e88607d722'
  + 'c190000000008b4830450220070aca44506c5cef3a16ed519d7c3c39f8aab192c4e1c9'
  + '0d065f37b8a4af6141022100a8e160b856c2d43d27d8fba71e5aef6405b8643ac4cb7c'
  + 'b3c462aced7f14711a0141046d11fee51b0e60666d5049a9101a72741df480b96ee264'
  + '88a4d3466b95c9a40ac5eeef87e10a5cd336c19a84565f80fa6c547957b7700ff4dfbd'
  + 'efe76036c339ffffffff021bff3d11000000001976a91404943fdd508053c75000106d'
  + '3bc6e2754dbcff1988ac2f15de00000000001976a914a266436d2965547608b9e15d90'
  + '32a7b9d64fa43188ac00000000';

bitcoind.on('error', function(err) {
  bitcoind.log('error="%s"', err.message);
});

bitcoind.on('open', function(status) {
  bitcoind.log('status="%s"', status);

  if (argv.list) {
    return bitcoind.log(bitcoind.wallet.listAccounts());
  }

  if (argv.blocks) {
    return getBlocks(bitcoind);
  }

  if (argv['test-tx']) {
    var tx = bitcoind.tx.fromHex(testTx);
    bitcoind.log(tx);
    bitcoind.log(tx.txid === tx.getHash('hex'));
    return;
  }

  function compareObj(obj) {
    // Hash
    if (obj.txid) {
      //bitcoind.log('tx.txid: %s', obj.txid);
      //bitcoind.log('tx.getHash("hex"): %s', obj.getHash('hex'));
      //bitcoind.log('tx.txid === tx.getHash("hex"): %s', obj.txid === obj.getHash('hex'));
      assert.equal(obj.hash, obj.getHash('hex'));
    } else {
      //bitcoind.log('block.hash: %s', obj.hash);
      //bitcoind.log('block.getHash("hex"): %s', obj.getHash('hex'));
      //bitcoind.log('block.hash === block.getHash("hex"): %s', obj.hash === obj.getHash('hex'));
      // XXX block hash is not equal
      //assert.equal(obj.hash, obj.getHash('hex'));
    }

    // Hex
    if (obj.txid) {
      //bitcoind.log('tx.hex: %s', obj.hex);
      //bitcoind.log('tx.toHex(): %s', obj.toHex());
      //bitcoind.log('tx.hex === tx.toHex(): %s', obj.hex === obj.toHex());
      assert.equal(obj.hex, obj.toHex());
    } else {
      //bitcoind.log('block.hex: %s', obj.hex);
      //bitcoind.log('block.toHex(): %s', obj.toHex());
      //bitcoind.log('block.hex === block.toHex(): %s', obj.hex === obj.toHex());
      // XXX block hex is not equal
      //assert.equal(obj.hex, obj.toHex());
    }
  }

  if (argv['on-block']) {
    return bitcoind.on('block', function callee(block) {
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return compareObj(block);
    });
  }

  if (argv['on-tx']) {
    bitcoind.on('tx', function(tx) {
      bitcoind.log('Found TX:');
      bitcoind.log(tx);
      return compareObj(tx);
    });
    bitcoind.on('mptx', function(mptx) {
      bitcoind.log('Found mempool TX:');
      bitcoind.log(mptx);
      return compareObj(mptx);
    });
    return;
  }

  if (argv.broadcast) {
    // Help propagate transactions
    return bitcoind.once('tx', function(tx) {
      bitcoind.log('Broadcasting TX...');
      return tx.broadcast(function(err, hash, tx) {
        if (err) throw err;
        bitcoind.log('TX Hash: %s', hash);
        return bitcoind.log(tx);
      });
    });
  }

  // Test fromHex:
  if (argv['from-hex']) {
    var block = bitcoind.block.fromHex(testBlock);
    assert.equal(block.hash, '0000000000013b8ab2cd513b0261a14096412195a72a0c4827d229dcc7e0f7af');
    assert.equal(block.merkleroot, '2fda58e5959b0ee53c5253da9b9f3c0c739422ae04946966991cf55895287552');
    bitcoind.log('Block:');
    bitcoind.log(block);
    var tx = bitcoind.tx.fromHex(testTx);
    assert.equal(tx.txid, 'b4749f017444b051c44dfd2720e88f314ff94f3dd6d56d40ef65854fcd7fff6b');
    bitcoind.log('Transaction:');
    bitcoind.log(tx);
    return;
  }

  // Test all parsed packets:
  if (argv['packets']) {
    bitcoind.on('parsed', function(packet) {
      return bitcoind.log(packet);
    });
    return;
  }

  argv['on-block'] = true;
  setTimeout(function() {
    bitcoind.on('block', function callee(block) {
      if (!argv['on-block']) {
        return bitcoind.removeListener('block', callee);
      }
      bitcoind.log('Found Block:');
      bitcoind.log(block);
      return compareObj(block);
    });

    bitcoind.once('block', function(block) {
      setTimeout(function() {
        argv['on-block'] = false;

        bitcoind.log(bitcoind.getInfo());
        bitcoind.log(bitcoind.getPeerInfo());
        bitcoind.log(bitcoind.wallet.listAccounts());

        bitcoind.once('version', function(version) {
          bitcoind.log('VERSION packet:');
          bitcoind.log(version);
        });

        bitcoind.once('addr', function(addr) {
          bitcoind.log('ADDR packet:');
          bitcoind.log(addr);
        });
      }, 8000);
    });
  }, 2000);

  return bitcoind.log(bitcoind.wallet.listAccounts());
});

/**
 * Helpers
 */

function getBlocks(bitcoind) {
  return setTimeout(function() {
    return (function next(hash) {
      return bitcoind.getBlock(hash, function(err, block) {
        if (err) return bitcoind.log(err.message);

        bitcoind.log(block);

        if (argv['get-tx'] && block.tx.length && block.tx[0].txid) {
          var txid = block.tx[0].txid;
          // XXX Dies with a segfault
          // bitcoind.getTx(txid, hash, function(err, tx) {
          bitcoind.getTx(txid, function(err, tx) {
            if (err) return bitcoind.log(err.message);
            bitcoind.log('TX -----------------------------------------------------');
            bitcoind.log(tx);
            bitcoind.log('/TX ----------------------------------------------------');
          });
        }

        if (block.nextblockhash) {
          setTimeout(next.bind(null, block.nextblockhash), 500);
        }
      });
    })(genesisBlock);
  }, 1000);
}
