/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.h:
 *   A bitcoind node.js binding header file.
 */
#include "nan.h"

/**
 * LevelDB
 */

#include <leveldb/cache.h>
#include <leveldb/options.h>
#include <leveldb/env.h>
#include <leveldb/filter_policy.h>
#include <memenv.h>
#include <leveldb/db.h>
#include <leveldb/write_batch.h>
#include <leveldb/comparator.h>

/**
 * secp256k1
 */

#include <secp256k1.h>

/**
 * Bitcoin headers
 */

#include "config/bitcoin-config.h"

#include "addrman.h"
#include "alert.h"
#include "allocators.h"
#include "amount.h"
#include "base58.h"
#include "bloom.h"
#include "bitcoind.h"
#include "chain.h"
#include "chainparams.h"
#include "chainparamsbase.h"
#include "checkpoints.h"
#include "checkqueue.h"
#include "clientversion.h"
#include "coincontrol.h"
#include "coins.h"
#include "compat.h"
#include "primitives/block.h"
#include "primitives/transaction.h"
#include "core_io.h"
#include "crypter.h"
#include "db.h"
#include "hash.h"
#include "init.h"
#include "key.h"
#include "keystore.h"
#include "leveldbwrapper.h"
#include "limitedmap.h"
#include "main.h"
#include "miner.h"
#include "mruset.h"
#include "netbase.h"
#include "net.h"
#include "noui.h"
#include "pow.h"
#include "protocol.h"
#include "random.h"
#include "rpcclient.h"
#include "rpcprotocol.h"
#include "rpcserver.h"
#include "rpcwallet.h"
#include "script/interpreter.h"
#include "script/script.h"
#include "script/sigcache.h"
#include "script/sign.h"
#include "script/standard.h"
#include "script/script_error.h"
#include "serialize.h"
#include "sync.h"
#include "threadsafety.h"
#include "timedata.h"
#include "tinyformat.h"
#include "txdb.h"
#include "txmempool.h"
#include "ui_interface.h"
#include "uint256.h"
#include "util.h"
#include "utilstrencodings.h"
#include "utilmoneystr.h"
#include "utiltime.h"
#include "version.h"
#include "wallet.h"
#include "wallet_ismine.h"
#include "walletdb.h"
#include "compat/sanity.h"

#include "json/json_spirit.h"
#include "json/json_spirit_error_position.h"
#include "json/json_spirit_reader.h"
#include "json/json_spirit_reader_template.h"
#include "json/json_spirit_stream_reader.h"
#include "json/json_spirit_utils.h"
#include "json/json_spirit_value.h"
#include "json/json_spirit_writer.h"
#include "json/json_spirit_writer_template.h"

#include "crypto/common.h"
#include "crypto/hmac_sha512.h"
#include "crypto/sha1.h"
#include "crypto/sha256.h"
#include "crypto/sha512.h"
#include "crypto/ripemd160.h"

#include "univalue/univalue_escapes.h"
#include "univalue/univalue.h"

/**
 * Bitcoin System
 */

#include <stdint.h>
#include <signal.h>
#include <stdio.h>

#include <fstream>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <boost/algorithm/string.hpp>
#include <boost/date_time/posix_time/posix_time.hpp>

#include <openssl/crypto.h>

// Need this because account names can be an empty string.
#define EMPTY ("\\x01")

// LevelDB options
#define USE_LDB_ADDR 0
#define USE_LDB_TX 0

#define SHUTTING_DOWN() (ShutdownRequested() || shutdown_complete)

/**
 * Node.js Exposed Function Templates
 */

NAN_METHOD(StartBitcoind);
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
NAN_METHOD(GetTransaction);
NAN_METHOD(BroadcastTx);
NAN_METHOD(VerifyBlock);
NAN_METHOD(VerifyTransaction);
NAN_METHOD(GetInfo);
NAN_METHOD(GetPeerInfo);
NAN_METHOD(GetAddresses);
NAN_METHOD(GetProgress);
NAN_METHOD(GetMiningInfo);
NAN_METHOD(GetAddrTransactions);
NAN_METHOD(GetBestBlock);
NAN_METHOD(GetChainHeight);
NAN_METHOD(GetBlockByTx);
NAN_METHOD(GetBlocksByTime);
NAN_METHOD(GetFromTx);
NAN_METHOD(GetLastFileIndex);
NAN_METHOD(GetBlockHex);
NAN_METHOD(GetTxHex);
NAN_METHOD(BlockFromHex);
NAN_METHOD(TxFromHex);
NAN_METHOD(HookPackets);

/**
 * Node.js System
 */

#include <node.h>
#include <string>

#include <string.h>
#include <stdlib.h>
#include <unistd.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <fcntl.h>

#include <termios.h>


#define DEBUG_TX 0
#define V090 0
