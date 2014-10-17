/**
 * bitcoind.js - a binding for node.js which links to libbitcoind.so.
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "nan.h"

#include "bitcoindjs.h"

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
#include "core.h"
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
#include "script/compressor.h"
#include "script/interpreter.h"
#include "script/script.h"
#include "script/sigcache.h"
#include "script/sign.h"
#include "script/standard.h"
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
#include "crypto/sha2.h"
#include "crypto/sha1.h"
#include "crypto/ripemd160.h"

#include "univalue/univalue_escapes.h"
#include "univalue/univalue.h"

/**
 * Bitcoin System
 */

#include <stdint.h>
#include <signal.h>
#include <stdio.h>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <openssl/crypto.h>

using namespace std;
using namespace boost;

/**
 * Bitcoin Globals
 */

// These global functions and variables are
// required to be defined/exposed here.

extern void DetectShutdownThread(boost::thread_group*);
extern int nScriptCheckThreads;
extern std::map<std::string, std::string> mapArgs;
#ifdef ENABLE_WALLET
extern std::string strWalletFile;
extern CWallet *pwalletMain;
#endif
extern CFeeRate payTxFee;
extern const std::string strMessageMagic;

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

using namespace node;
using namespace v8;

/**
 * Node.js Exposed Function Templates
 */

NAN_METHOD(StartBitcoind);
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);
NAN_METHOD(GetTx);
NAN_METHOD(PollBlocks);
NAN_METHOD(PollMempool);
NAN_METHOD(BroadcastTx);
NAN_METHOD(VerifyBlock);
NAN_METHOD(VerifyTransaction);
NAN_METHOD(FillTransaction);
NAN_METHOD(GetInfo);
NAN_METHOD(GetPeerInfo);
NAN_METHOD(GetBlockHex);
NAN_METHOD(GetTxHex);
NAN_METHOD(BlockFromHex);
NAN_METHOD(TxFromHex);

NAN_METHOD(WalletNewAddress);
NAN_METHOD(WalletGetAccountAddress);
NAN_METHOD(WalletSetAccount);
NAN_METHOD(WalletGetAccount);
NAN_METHOD(WalletSendTo);
NAN_METHOD(WalletSignMessage);
NAN_METHOD(WalletVerifyMessage);
NAN_METHOD(WalletGetBalance);
NAN_METHOD(WalletCreateMultiSigAddress);
NAN_METHOD(WalletGetUnconfirmedBalance);
NAN_METHOD(WalletSendFrom);
NAN_METHOD(WalletListTransactions);
NAN_METHOD(WalletListAccounts);
NAN_METHOD(WalletGetTransaction);
NAN_METHOD(WalletBackup);
NAN_METHOD(WalletPassphrase);
NAN_METHOD(WalletPassphraseChange);
NAN_METHOD(WalletLock);
NAN_METHOD(WalletEncrypt);
NAN_METHOD(WalletSetTxFee);
NAN_METHOD(WalletImportKey);

/**
 * Node.js Internal Function Templates
 */

static void
async_start_node(uv_work_t *req);

static void
async_start_node_after(uv_work_t *req);

static void
async_stop_node(uv_work_t *req);

static void
async_stop_node_after(uv_work_t *req);

static int
start_node(void);

static void
start_node_thread(void);

static void
async_get_block(uv_work_t *req);

static void
async_get_block_after(uv_work_t *req);

static void
async_get_tx(uv_work_t *req);

static void
async_get_tx_after(uv_work_t *req);

static void
async_poll_blocks(uv_work_t *req);

static void
async_poll_blocks_after(uv_work_t *req);

static void
async_poll_mempool(uv_work_t *req);

static void
async_poll_mempool_after(uv_work_t *req);

static void
async_broadcast_tx(uv_work_t *req);

static void
async_broadcast_tx_after(uv_work_t *req);

static void
async_wallet_sendto(uv_work_t *req);

static void
async_wallet_sendto_after(uv_work_t *req);

static void
async_wallet_sendfrom(uv_work_t *req);

static void
async_wallet_sendfrom_after(uv_work_t *req);

static void
async_import_key(uv_work_t *req);

static void
async_import_key_after(uv_work_t *req);

static inline void
cblock_to_jsblock(const CBlock& cblock, const CBlockIndex* cblock_index, Local<Object> jsblock);

static inline void
ctx_to_jstx(const CTransaction& ctx, uint256 block_hash, Local<Object> jstx);

static inline void
jsblock_to_cblock(const Local<Object> jsblock, CBlock& cblock);

static inline void
jstx_to_ctx(const Local<Object> jstx, CTransaction& ctx);

extern "C" void
init(Handle<Object>);

/**
 * Private Global Variables
 * Used only by bitcoindjs functions.
 */

static volatile bool shutdown_complete = false;
static int block_poll_top_height = -1;
static char *g_data_dir = NULL;
static bool g_rpc = false;

/**
 * Private Structs
 * Used for async functions and necessary linked lists at points.
 */

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_node_data {
  std::string err_msg;
  std::string result;
  std::string datadir;
  bool rpc;
  Persistent<Function> callback;
};

/**
 * async_block_data
 */

struct async_block_data {
  std::string err_msg;
  std::string hash;
  CBlock result_block;
  CBlockIndex* result_blockindex;
  Persistent<Function> callback;
};

/**
 * async_tx_data
 */

struct async_tx_data {
  std::string err_msg;
  std::string txHash;
  std::string blockHash;
  CTransaction ctx;
  Persistent<Function> callback;
};

/**
 * poll_blocks_list
 * A singly linked list containing any polled CBlocks and CBlockIndexes.
 * Contained by async_poll_blocks_data struct.
 */

typedef struct _poll_blocks_list {
  CBlock cblock;
  CBlockIndex *cblock_index;
  struct _poll_blocks_list *next;
} poll_blocks_list;

/**
 * async_poll_blocks_data
 */

struct async_poll_blocks_data {
  std::string err_msg;
  poll_blocks_list *head;
  Persistent<Array> result_array;
  Persistent<Function> callback;
};

/**
 * async_poll_mempool_data
 */

struct async_poll_mempool_data {
  std::string err_msg;
  Persistent<Array> result_array;
  Persistent<Function> callback;
};

/**
 * async_broadcast_tx_data
 */

struct async_broadcast_tx_data {
  std::string err_msg;
  Persistent<Object> jstx;
  CTransaction ctx;
  std::string tx_hash;
  bool override_fees;
  bool own_only;
  Persistent<Function> callback;
};

/**
 * async_wallet_sendto_data
 */

struct async_wallet_sendto_data {
  std::string err_msg;
  std::string tx_hash;
  std::string address;
  int64_t nAmount;
  CWalletTx wtx;
  Persistent<Function> callback;
};

/**
 * async_wallet_sendfrom_data
 */

struct async_wallet_sendfrom_data {
  std::string err_msg;
  std::string tx_hash;
  std::string address;
  int64_t nAmount;
  int nMinDepth;
  CWalletTx wtx;
  Persistent<Function> callback;
};

/**
 * async_import_key_data
 */

struct async_import_key_data {
  std::string err_msg;
  bool fRescan;
  Persistent<Function> callback;
};

/**
 * Functions
 */

/**
 * StartBitcoind()
 * bitcoind.start(callback)
 * Start the bitcoind node with AppInit2() on a separate thread.
 */

NAN_METHOD(StartBitcoind) {
  NanScope();

  Local<Function> callback;
  std::string datadir = std::string("");
  bool rpc = false;

  if (args.Length() >= 2 && args[0]->IsObject() && args[1]->IsFunction()) {
    Local<Object> options = Local<Object>::Cast(args[0]);
    if (options->Get(NanNew<String>("datadir"))->IsString()) {
      String::Utf8Value datadir_(options->Get(NanNew<String>("datadir"))->ToString());
      datadir = std::string(*datadir_);
    }
    if (options->Get(NanNew<String>("rpc"))->IsBoolean()) {
      rpc = options->Get(NanNew<String>("rpc"))->ToBoolean()->IsTrue();
    }
    callback = Local<Function>::Cast(args[1]);
  } else if (args.Length() >= 2
             && (args[0]->IsUndefined() || args[0]->IsNull())
             && args[1]->IsFunction()) {
    callback = Local<Function>::Cast(args[1]);
  } else if (args.Length() >= 1 && args[0]->IsFunction()) {
    callback = Local<Function>::Cast(args[0]);
  } else {
    return NanThrowError(
      "Usage: bitcoind.start(callback)");
  }

  //
  // Run bitcoind's StartNode() on a separate thread.
  //

  async_node_data *data = new async_node_data();
  data->err_msg = std::string("");
  data->result = std::string("");
  data->datadir = datadir;
  data->rpc = rpc;
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_start_node,
    (uv_after_work_cb)async_start_node_after);

  assert(status == 0);

  NanReturnValue(NanNew<Number>(-1));
}

/**
 * async_start_node()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node(uv_work_t *req) {
  async_node_data *data = static_cast<async_node_data*>(req->data);
  if (!data->datadir.empty()) {
    g_data_dir = (char *)data->datadir.c_str();
  }
  g_rpc = (bool)data->rpc;
  start_node();
  data->result = std::string("start_node(): bitcoind opened.");
}

/**
 * async_start_node_after()
 * Execute our callback.
 */

static void
async_start_node_after(uv_work_t *req) {
  NanScope();
  async_node_data *data = static_cast<async_node_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(data->result.c_str()))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  // XXX Figure out what to do here:
  // data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * start_node(void)
 * Start AppInit2() on a separate thread, wait for
 * pwalletMain instantiation (and signal() calls).
 * Unfortunately, we need to wait for the initialization
 * to unhook the signal handlers so we can use them
 * from node.js in javascript.
 */

static int
start_node(void) {
  SetupEnvironment();

  noui_connect();

  (boost::thread *)new boost::thread(boost::bind(&start_node_thread));

  // Wait for wallet to be instantiated. This also avoids
  // a race condition with signals not being set up.
  while (!pwalletMain) {
    useconds_t usec = 100 * 1000;
    usleep(usec);
  }

  // Drop the bitcoind signal handlers: we want our own.
  signal(SIGINT, SIG_DFL);
  signal(SIGHUP, SIG_DFL);
  signal(SIGQUIT, SIG_DFL);

  return 0;
}

static void
start_node_thread(void) {
  boost::thread_group threadGroup;
  boost::thread* detectShutdownThread = NULL;

  // Workaround for AppInit2() arg parsing. Not ideal, but it works.
  int argc = 0;
  char **argv = (char **)malloc((3 + 1) * sizeof(char **));

  argv[0] = (char *)"bitcoind";

  if (g_data_dir) {
    const int argl = 9 + strlen(g_data_dir) + 1;
    char *arg = (char *)malloc(argl);
    int w = snprintf(arg, argl, "-datadir=%s", g_data_dir);
    if (w <= 0 || w >= argl) {
      NanThrowError("Bad -datadir value.");
      return;
    }
    arg[w] = '\0';

    argc = 2;
    argv[1] = arg;
  } else {
    argc = 1;
  }

  if (g_rpc) {
    argv[argc] = (char *)"-server";
    argc++;
  }

  argv[argc] = NULL;

  bool fRet = false;
  try {
    ParseParameters((const int)argc, (const char **)argv);

    if (!boost::filesystem::is_directory(GetDataDir(false))) {
      fprintf(stderr,
        "Error: Specified data directory \"%s\" does not exist.\n",
        mapArgs["-datadir"].c_str());
      return;
    }

    try {
      ReadConfigFile(mapArgs, mapMultiArgs);
    } catch(std::exception &e) {
      fprintf(stderr,"Error reading configuration file: %s\n", e.what());
      return;
    }

    if (!SelectParamsFromCommandLine()) {
      fprintf(stderr, "Error: Invalid combination of -regtest and -testnet.\n");
      return;
    }

    // XXX Potentially add an option for this.
    // This is probably a good idea if people try to start bitcoind while
    // running a program which links to libbitcoind.so, but disable it for now.
    CreatePidFile(GetPidFile(), getpid());

    detectShutdownThread = new boost::thread(
      boost::bind(&DetectShutdownThread, &threadGroup));
    fRet = AppInit2(threadGroup);
  } catch (std::exception& e) {
    fprintf(stderr, "AppInit(): std::exception");
  } catch (...) {
    fprintf(stderr, "AppInit(): other exception");
  }

  if (!fRet) {
    if (detectShutdownThread) {
      detectShutdownThread->interrupt();
    }
    threadGroup.interrupt_all();
  }

  if (detectShutdownThread) {
    detectShutdownThread->join();
    delete detectShutdownThread;
    detectShutdownThread = NULL;
  }
  Shutdown();

  // bitcoind is shutdown, notify the main thread.
  shutdown_complete = true;
}

/**
 * StopBitcoind()
 * bitcoind.stop(callback)
 */

NAN_METHOD(StopBitcoind) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoind.stop(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  //
  // Run bitcoind's StartShutdown() on a separate thread.
  //

  async_node_data *data = new async_node_data();
  data->err_msg = std::string("");
  data->result = std::string("");
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_stop_node,
    (uv_after_work_cb)async_stop_node_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

/**
 * async_stop_node()
 * Call StartShutdown() to join the boost threads, which will call Shutdown()
 * and set shutdown_complete to true to notify the main node.js thread.
 */

static void
async_stop_node(uv_work_t *req) {
  async_node_data *data = static_cast<async_node_data*>(req->data);
  StartShutdown();
  data->result = std::string("stop_node(): bitcoind shutdown.");
}

/**
 * async_stop_node_after()
 * Execute our callback.
 */

static void
async_stop_node_after(uv_work_t *req) {
  NanScope();
  async_node_data* data = static_cast<async_node_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(data->result.c_str()))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * IsStopping()
 * bitcoind.stopping()
 * Check whether bitcoind is in the process of shutting down. This is polled
 * from javascript.
 */

NAN_METHOD(IsStopping) {
  NanScope();
  NanReturnValue(NanNew<Boolean>(ShutdownRequested()));
}

/**
 * IsStopped()
 * bitcoind.stopped()
 * Check whether bitcoind has shutdown completely. This will be polled by
 * javascript to check whether the libuv event loop is safe to stop.
 */

NAN_METHOD(IsStopped) {
  NanScope();
  NanReturnValue(NanNew<Boolean>(shutdown_complete));
}

/**
 * GetBlock()
 * bitcoind.getBlock(blockHash, callback)
 * Read any block from disk asynchronously.
 */

NAN_METHOD(GetBlock) {
  NanScope();

  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getBlock(blockHash, callback)");
  }

  String::Utf8Value hash(args[0]->ToString());
  Local<Function> callback = Local<Function>::Cast(args[1]);

  std::string hashp = std::string(*hash);

  async_block_data *data = new async_block_data();
  data->err_msg = std::string("");
  data->hash = hashp;
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_block,
    (uv_after_work_cb)async_get_block_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_get_block(uv_work_t *req) {
  async_block_data* data = static_cast<async_block_data*>(req->data);
  std::string strHash = data->hash;
  uint256 hash(strHash);
  CBlock cblock;
  CBlockIndex* pblockindex = mapBlockIndex[hash];
  if (ReadBlockFromDisk(cblock, pblockindex)) {
    data->result_block = cblock;
    data->result_blockindex = pblockindex;
  } else {
    data->err_msg = std::string("get_block(): failed.");
  }
}

static void
async_get_block_after(uv_work_t *req) {
  NanScope();
  async_block_data* data = static_cast<async_block_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const CBlock& cblock = data->result_block;
    const CBlockIndex* cblock_index = data->result_blockindex;

    Local<Object> jsblock = NanNew<Object>();
    cblock_to_jsblock(cblock, cblock_index, jsblock);

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(jsblock)
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * GetTx()
 * bitcoind.getTx(txHash, [blockHash], callback)
 * Read any transaction from disk asynchronously.
 */

NAN_METHOD(GetTx) {
  NanScope();

  if (args.Length() < 3
      || !args[0]->IsString()
      || !args[1]->IsString()
      || !args[2]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getTx(txHash, [blockHash], callback)");
  }

  String::Utf8Value txHash_(args[0]->ToString());
  String::Utf8Value blockHash_(args[1]->ToString());
  Local<Function> callback = Local<Function>::Cast(args[2]);

  Persistent<Function> cb;
  cb = Persistent<Function>::New(callback);

  std::string txHash = std::string(*txHash_);
  std::string blockHash = std::string(*blockHash_);

  if (blockHash.empty()) {
    blockHash = std::string("0x0000000000000000000000000000000000000000000000000000000000000000");
  }

  async_tx_data *data = new async_tx_data();
  data->err_msg = std::string("");
  data->txHash = txHash;
  data->blockHash = blockHash;
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_tx,
    (uv_after_work_cb)async_get_tx_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_get_tx(uv_work_t *req) {
  async_tx_data* data = static_cast<async_tx_data*>(req->data);

  uint256 hash(data->txHash);
  uint256 block_hash(data->blockHash);
  CTransaction ctx;

  if (GetTransaction(hash, ctx, block_hash, true)) {
    data->ctx = ctx;
  } else {
    data->err_msg = std::string("get_tx(): failed.");
  }
}

static void
async_get_tx_after(uv_work_t *req) {
  NanScope();
  async_tx_data* data = static_cast<async_tx_data*>(req->data);

  std::string txHash = data->txHash;
  std::string blockHash = data->blockHash;
  CTransaction ctx = data->ctx;

  uint256 hash(txHash);
  uint256 block_hash(blockHash);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    Local<Object> jstx = NanNew<Object>();
    ctx_to_jstx(ctx, block_hash, jstx);

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(jstx)
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * PollBlocks()
 * bitcoind.pollBlocks(callback)
 * Poll for new blocks on the chain. This is necessary since we have no way of
 * hooking in to AcceptBlock(). Instead, we constant check for new blocks using
 * a SetTimeout() within node.js.
 * Creating a linked list of all blocks within the work function is necessary
 * due to doing v8 things within the libuv thread pool will cause a segfault.
 * Since this reads full blocks, obviously it will poll for transactions which
 * have already been included in blocks as well.
 */

NAN_METHOD(PollBlocks) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.pollBlocks(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  async_poll_blocks_data *data = new async_poll_blocks_data();
  data->err_msg = std::string("");
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_poll_blocks,
    (uv_after_work_cb)async_poll_blocks_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_poll_blocks(uv_work_t *req) {
  async_poll_blocks_data* data = static_cast<async_poll_blocks_data*>(req->data);

  int poll_saved_height = block_poll_top_height;

  // Poll, wait until we actually have a blockchain download.
  // Once we've noticed the height changed, assume we gained a few blocks.
  while (chainActive.Tip()) {
    int cur_height = chainActive.Height();
    if (cur_height != block_poll_top_height) {
      block_poll_top_height = cur_height;
      break;
    }
    // Try again in 100ms
    useconds_t usec = 100 * 1000;
    usleep(usec);
  }

  // NOTE: Since we can't do v8 stuff on the uv thread pool, we need to create
  // a linked list for all the blocks and free them up later.
  poll_blocks_list *head = NULL;
  poll_blocks_list *cur = NULL;

  for (int i = poll_saved_height; i < block_poll_top_height; i++) {
    if (i == -1) continue;
    CBlockIndex *cblock_index = chainActive[i];
    if (cblock_index != NULL) {
      CBlock cblock;
      if (ReadBlockFromDisk(cblock, cblock_index)) {
        poll_blocks_list *next = new poll_blocks_list();
        next->next = NULL;
        if (cur == NULL) {
          head = next;
          cur = next;
        } else {
          cur->next = next;
          cur = next;
        }
        cur->cblock = cblock;
        cur->cblock_index = cblock_index;
      }
    }
  }

  data->head = head;
}

static void
async_poll_blocks_after(uv_work_t *req) {
  NanScope();
  async_poll_blocks_data* data = static_cast<async_poll_blocks_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Array> blocks = NanNew<Array>();

    poll_blocks_list *cur = static_cast<poll_blocks_list*>(data->head);
    poll_blocks_list *next;
    int i = 0;

    while (cur != NULL) {
      CBlock cblock = cur->cblock;
      CBlockIndex *cblock_index = cur->cblock_index;
      Local<Object> jsblock = NanNew<Object>();
      cblock_to_jsblock(cblock, cblock_index, jsblock);
      blocks->Set(i, jsblock);
      i++;
      next = cur->next;
      delete cur;
      cur = next;
    }

    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(blocks)
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * PollMempool()
 * bitcoind.pollMempool(callback)
 * This will poll for any transactions in the mempool. i.e. Transactions which
 * have not been included in blocks yet. This is not technically necessary to
 * be done asynchronously since there are no real blocking calls done here, but
 * we will leave the async function here as a placeholder in case we're wrong.
 */

NAN_METHOD(PollMempool) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.pollMempool(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  async_poll_mempool_data *data = new async_poll_mempool_data();
  data->err_msg = std::string("");
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_poll_mempool,
    (uv_after_work_cb)async_poll_mempool_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_poll_mempool(uv_work_t *req) {
  // XXX Potentially do everything async, but would it matter? Everything is in
  // memory. There aren't really any harsh blocking calls. Leave this here as a
  // placeholder.
  useconds_t usec = 5 * 1000;
  usleep(usec);
}

static void
async_poll_mempool_after(uv_work_t *req) {
  NanScope();
  async_poll_mempool_data* data = static_cast<async_poll_mempool_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    int ti = 0;
    Local<Array> txs = NanNew<Array>();

    {
      std::map<uint256, CTxMemPoolEntry>::const_iterator it = mempool.mapTx.begin();
      for (; it != mempool.mapTx.end(); it++) {
        const CTransaction& ctx = it->second.GetTx();
        Local<Object> jstx = NanNew<Object>();
        ctx_to_jstx(ctx, 0, jstx);
        txs->Set(ti, jstx);
        ti++;
      }
    }

    {
      std::map<COutPoint, CInPoint>::const_iterator it = mempool.mapNextTx.begin();
      for (; it != mempool.mapNextTx.end(); it++) {
        const CTransaction ctx = *it->second.ptx;
        Local<Object> jstx = NanNew<Object>();
        ctx_to_jstx(ctx, 0, jstx);
        txs->Set(ti, jstx);
        ti++;
      }
    }

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(txs)
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * BroadcastTx()
 * bitcoind.broadcastTx(tx, override_fees, own_only, callback)
 * Broadcast a raw transaction. This can be used to relay transaction received
 * or to broadcast one's own transaction.
 */

NAN_METHOD(BroadcastTx) {
  NanScope();

  if (args.Length() < 4
      || !args[0]->IsObject()
      || !args[1]->IsBoolean()
      || !args[2]->IsBoolean()
      || !args[3]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.broadcastTx(tx, override_fees, own_only, callback)");
  }

  Local<Object> jstx = Local<Object>::Cast(args[0]);
  Local<Function> callback = Local<Function>::Cast(args[3]);

  async_broadcast_tx_data *data = new async_broadcast_tx_data();
  data->override_fees = args[1]->ToBoolean()->IsTrue();
  data->own_only = args[2]->ToBoolean()->IsTrue();
  data->err_msg = std::string("");
  data->callback = Persistent<Function>::New(callback);

  data->jstx = Persistent<Object>::New(jstx);

  CTransaction ctx;
  jstx_to_ctx(jstx, ctx);
  data->ctx = ctx;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_broadcast_tx,
    (uv_after_work_cb)async_broadcast_tx_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_broadcast_tx(uv_work_t *req) {
  async_broadcast_tx_data* data = static_cast<async_broadcast_tx_data*>(req->data);

  bool fOverrideFees = false;
  bool fOwnOnly = false;

  if (data->override_fees) {
    fOverrideFees = true;
  }

  if (data->own_only) {
    fOwnOnly = true;
  }

  CTransaction ctx = data->ctx;

  uint256 hashTx = ctx.GetHash();

  bool fHave = false;
  CCoinsViewCache &view = *pcoinsTip;
  CCoins existingCoins;
  if (fOwnOnly) {
    fHave = view.GetCoins(hashTx, existingCoins);
    if (!fHave) {
      CValidationState state;
      if (!AcceptToMemoryPool(mempool, state, ctx, false, NULL, !fOverrideFees)) {
        data->err_msg = std::string("TX rejected");
        return;
      }
    }
  }

  if (fHave) {
    if (existingCoins.nHeight < 1000000000) {
      data->err_msg = std::string("transaction already in block chain");
      return;
    }
  } else {
    // With v0.9.0
    // SyncWithWallets(hashTx, ctx, NULL);
  }

  RelayTransaction(ctx);

  data->tx_hash = hashTx.GetHex();
}

static void
async_broadcast_tx_after(uv_work_t *req) {
  NanScope();
  async_broadcast_tx_data* data = static_cast<async_broadcast_tx_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 3;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(NanNew<String>(data->tx_hash)),
      Local<Value>::New(data->jstx)
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * VerifyBlock()
 * bitcoindjs.verifyBlock(block)
 * This will verify the authenticity of a block (merkleRoot, etc)
 * using the internal bitcoind functions.
 */

NAN_METHOD(VerifyBlock) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.verifyBlock(block)");
  }

  Local<Object> jsblock = Local<Object>::Cast(args[0]);

  String::Utf8Value block_hex_(jsblock->Get(NanNew<String>("hex"))->ToString());
  std::string block_hex = std::string(*block_hex_);

  CBlock cblock;
  jsblock_to_cblock(jsblock, cblock);

  CValidationState state;
  bool valid = CheckBlock(cblock, state);

  NanReturnValue(NanNew<Boolean>(valid));
}

/**
 * VerifyTransaction()
 * bitcoindjs.verifyTransaction(tx)
 * This will verify a transaction, ensuring it is signed properly using the
 * internal bitcoind functions.
 */

NAN_METHOD(VerifyTransaction) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.verifyTransaction(tx)");
  }

  Local<Object> jstx = Local<Object>::Cast(args[0]);

  String::Utf8Value tx_hex_(jstx->Get(NanNew<String>("hex"))->ToString());
  std::string tx_hex = std::string(*tx_hex_);

  CTransaction ctx;
  jstx_to_ctx(jstx, ctx);

  CValidationState state;
  bool valid = CheckTransaction(ctx, state);

  std::string reason;
  bool standard = IsStandardTx(ctx, reason);

  NanReturnValue(NanNew<Boolean>(valid && standard));
}

/**
 * FillTransaction()
 * bitcoindjs.fillTransaction(tx, options);
 * This will fill a javascript transaction object with the proper available
 * unpsent outputs as inputs and sign them using internal bitcoind functions.
 */

NAN_METHOD(FillTransaction) {
  NanScope();

  if (args.Length() < 2 || !args[0]->IsObject() || !args[1]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.fillTransaction(tx, options)");
  }

  Local<Object> jstx = Local<Object>::Cast(args[0]);
  // Local<Object> options = Local<Object>::Cast(args[1]);

  String::Utf8Value tx_hex_(jstx->Get(NanNew<String>("hex"))->ToString());
  std::string tx_hex = std::string(*tx_hex_);

  CTransaction ctx;
  jstx_to_ctx(jstx, ctx);

  // Get total value of outputs
  // Get the scriptPubKey of the first output (presumably our destination)
  int64_t nValue = 0;
  for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
    const CTxOut& txout = ctx.vout[vo];
    int64_t value = txout.nValue;
    const CScript& scriptPubKey = txout.scriptPubKey;
    nValue += value;
  }

  if (nValue <= 0)
    return NanThrowError("Invalid amount");
  // With v0.9.0:
  // if (nValue + nTransactionFee > pwalletMain->GetBalance())
  // if (nValue + payTxFee > pwalletMain->GetBalance())
  //   return NanThrowError("Insufficient funds");
  if (nValue > pwalletMain->GetBalance())
    return NanThrowError("Insufficient funds");

  // With v0.9.0:
  // int64_t nFeeRet = nTransactionFee;
  int64_t nFeeRet = 1000;
  // int64_t nFeeRet = CFeeRate(nAmount, 1000);

  if (pwalletMain->IsLocked()) {
    return NanThrowError("Error: Wallet locked, unable to create transaction!");
  }

  CCoinControl* coinControl = new CCoinControl();

  int64_t nTotalValue = nValue + nFeeRet;
  set<pair<const CWalletTx*,unsigned int> > setCoins;
  int64_t nValueIn = 0;

  if (!pwalletMain->SelectCoins(nTotalValue, setCoins, nValueIn, coinControl)) {
    return NanThrowError("Insufficient funds");
  }

  // Fill vin
  BOOST_FOREACH(const PAIRTYPE(const CWalletTx*, unsigned int)& coin, setCoins) {
    ctx.vin.push_back(CTxIn(coin.first->GetHash(), coin.second));
  }

  // Sign
  int nIn = 0;
  BOOST_FOREACH(const PAIRTYPE(const CWalletTx*,unsigned int)& coin, setCoins) {
    if (!SignSignature(
      (const CKeyStore&)*pwalletMain,
      (const CTransaction&)*coin.first,
      (CMutableTransaction&)ctx,
      nIn++)
    ) {
      return NanThrowError("Signing transaction failed");
    }
  }

  // Turn our CTransaction into a javascript Transaction
  Local<Object> new_jstx = NanNew<Object>();
  ctx_to_jstx(ctx, 0, new_jstx);

  NanReturnValue(new_jstx);
}

/**
 * GetInfo()
 * bitcoindjs.GetInfo()
 * Get miscellaneous information
 */

NAN_METHOD(GetInfo) {
  NanScope();

  if (args.Length() > 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getInfo()");
  }

  Local<Object> obj = NanNew<Object>();

  proxyType proxy;
  GetProxy(NET_IPV4, proxy);

  obj->Set(NanNew<String>("version"), NanNew<Number>(CLIENT_VERSION));
  obj->Set(NanNew<String>("protocolversion"), NanNew<Number>(PROTOCOL_VERSION));
#ifdef ENABLE_WALLET
  if (pwalletMain) {
    obj->Set(NanNew<String>("walletversion"), NanNew<Number>(pwalletMain->GetVersion()));
    obj->Set(NanNew<String>("balance"), NanNew<Number>(pwalletMain->GetBalance())); // double
  }
#endif
  obj->Set(NanNew<String>("blocks"), NanNew<Number>((int)chainActive.Height())->ToInt32());
  obj->Set(NanNew<String>("timeoffset"), NanNew<Number>(GetTimeOffset()));
  obj->Set(NanNew<String>("connections"), NanNew<Number>((int)vNodes.size())->ToInt32());
  obj->Set(NanNew<String>("proxy"), NanNew<String>(proxy.IsValid() ? proxy.ToStringIPPort() : std::string("")));
  obj->Set(NanNew<String>("difficulty"), NanNew<Number>((double)GetDifficulty()));
  obj->Set(NanNew<String>("testnet"), NanNew<Boolean>(Params().NetworkID() == CBaseChainParams::TESTNET));
#ifdef ENABLE_WALLET
  if (pwalletMain) {
    obj->Set(NanNew<String>("keypoololdest"), NanNew<Number>(pwalletMain->GetOldestKeyPoolTime()));
    obj->Set(NanNew<String>("keypoolsize"), NanNew<Number>((int)pwalletMain->GetKeyPoolSize())->ToInt32());
  }
  if (pwalletMain && pwalletMain->IsCrypted()) {
    obj->Set(NanNew<String>("unlocked_until"), NanNew<Number>(nWalletUnlockTime));
  }
  obj->Set(NanNew<String>("paytxfee"), NanNew<Number>(payTxFee.GetFeePerK())); // double
#endif
  obj->Set(NanNew<String>("relayfee"), NanNew<Number>(::minRelayTxFee.GetFeePerK())); // double
  obj->Set(NanNew<String>("errors"), NanNew<String>(GetWarnings("statusbar")));

  NanReturnValue(obj);
}

/**
 * GetPeerInfo()
 * bitcoindjs.GetPeerInfo()
 * Get peer information
 */

NAN_METHOD(GetPeerInfo) {
  NanScope();

  if (args.Length() > 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getPeerInfo()");
  }

  Local<Array> array = NanNew<Array>();
  int i = 0;

  vector<CNodeStats> vstats;
  vstats.clear();
  LOCK(cs_vNodes);
  vstats.reserve(vNodes.size());
  BOOST_FOREACH(CNode* pnode, vNodes) {
    CNodeStats stats;
    pnode->copyStats(stats);
    vstats.push_back(stats);
  }

  BOOST_FOREACH(const CNodeStats& stats, vstats) {
    Local<Object> obj = NanNew<Object>();

    CNodeStateStats statestats;
    bool fStateStats = GetNodeStateStats(stats.nodeid, statestats);
    obj->Set(NanNew<String>("id"), NanNew<Number>(stats.nodeid));
    obj->Set(NanNew<String>("addr"), NanNew<String>(stats.addrName));
    if (!(stats.addrLocal.empty())) {
      obj->Set(NanNew<String>("addrlocal"), NanNew<String>(stats.addrLocal));
    }
    obj->Set(NanNew<String>("services"), NanNew<String>(strprintf("%016x", stats.nServices)));
    obj->Set(NanNew<String>("lastsend"), NanNew<Number>(stats.nLastSend));
    obj->Set(NanNew<String>("lastrecv"), NanNew<Number>(stats.nLastRecv));
    obj->Set(NanNew<String>("bytessent"), NanNew<Number>(stats.nSendBytes));
    obj->Set(NanNew<String>("bytesrecv"), NanNew<Number>(stats.nRecvBytes));
    obj->Set(NanNew<String>("conntime"), NanNew<Number>(stats.nTimeConnected));
    obj->Set(NanNew<String>("pingtime"), NanNew<Number>(stats.dPingTime)); // double
    if (stats.dPingWait > 0.0) {
      obj->Set(NanNew<String>("pingwait"), NanNew<Number>(stats.dPingWait)); // double
    }
    obj->Set(NanNew<String>("version"), NanNew<Number>(stats.nVersion));
    obj->Set(NanNew<String>("subver"), NanNew<String>(stats.cleanSubVer));
    obj->Set(NanNew<String>("inbound"), NanNew<Boolean>(stats.fInbound));
    obj->Set(NanNew<String>("startingheight"), NanNew<Number>(stats.nStartingHeight));
    if (fStateStats) {
      obj->Set(NanNew<String>("banscore"), NanNew<Number>(statestats.nMisbehavior));
      obj->Set(NanNew<String>("syncheight"), NanNew<Number>(statestats.nSyncHeight)->ToInt32());
    }
    obj->Set(NanNew<String>("syncnode"), NanNew<Boolean>(stats.fSyncNode));
    obj->Set(NanNew<String>("whitelisted"), NanNew<Boolean>(stats.fWhitelisted));

    array->Set(i, obj);
    i++;
  }

  NanReturnValue(array);
}

/**
 * GetBlockHex()
 * bitcoindjs.getBlockHex(callback)
 * This will return the hex value as well as hash of a javascript block object
 * (after being converted to a CBlock).
 */

NAN_METHOD(GetBlockHex) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.getBlockHex(block)");
  }

  Local<Object> jsblock = Local<Object>::Cast(args[0]);

  CBlock cblock;
  jsblock_to_cblock(jsblock, cblock);

  Local<Object> data = NanNew<Object>();

  data->Set(NanNew<String>("hash"), NanNew<String>(cblock.GetHash().GetHex().c_str()));

  CDataStream ssBlock(SER_NETWORK, PROTOCOL_VERSION);
  ssBlock << cblock;
  std::string strHex = HexStr(ssBlock.begin(), ssBlock.end());
  data->Set(NanNew<String>("hex"), NanNew<String>(strHex));

  NanReturnValue(data);
}

/**
 * GetTxHex()
 * bitcoindjs.getTxHex(tx)
 * This will return the hex value and hash for any tx, converting a js tx
 * object to a CTransaction.
 */

NAN_METHOD(GetTxHex) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.getTxHex(tx)");
  }

  Local<Object> jstx = Local<Object>::Cast(args[0]);

  CTransaction ctx;
  jstx_to_ctx(jstx, ctx);

  Local<Object> data = NanNew<Object>();

  data->Set(NanNew<String>("hash"), NanNew<String>(ctx.GetHash().GetHex().c_str()));

  CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
  ssTx << ctx;
  std::string strHex = HexStr(ssTx.begin(), ssTx.end());
  data->Set(NanNew<String>("hex"), NanNew<String>(strHex));

  NanReturnValue(data);
}

/**
 * BlockFromHex()
 * bitcoindjs.blockFromHex(hex)
 * Create a javascript block from a hex string.
 */

NAN_METHOD(BlockFromHex) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsString()) {
    return NanThrowError(
      "Usage: bitcoindjs.blockFromHex(hex)");
  }

  String::AsciiValue hex_string_(args[0]->ToString());
  std::string hex_string = *hex_string_;

  CBlock cblock;
  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> cblock;
  } catch (std::exception &e) {
    NanThrowError("Bad Block decode");
  }

  Local<Object> jsblock = NanNew<Object>();
  cblock_to_jsblock(cblock, 0, jsblock);

  NanReturnValue(jsblock);
}

/**
 * TxFromHex()
 * bitcoindjs.txFromHex(hex)
 * Create a javascript tx from a hex string.
 */

NAN_METHOD(TxFromHex) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsString()) {
    return NanThrowError(
      "Usage: bitcoindjs.txFromHex(hex)");
  }

  String::AsciiValue hex_string_(args[0]->ToString());
  std::string hex_string = *hex_string_;

  CTransaction ctx;
  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> ctx;
  } catch (std::exception &e) {
    NanThrowError("Bad Block decode");
  }

  Local<Object> jstx = NanNew<Object>();
  ctx_to_jstx(ctx, 0, jstx);

  NanReturnValue(jstx);
}

/**
 * WalletNewAddress()
 * bitcoindjs.walletNewAddress(options)
 * Create a new address in the global pwalletMain.
 */

NAN_METHOD(WalletNewAddress) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletNewAddress(options)");
  }

  // Parse the account first so we don't generate a key if there's an error
  Local<Object> options = Local<Object>::Cast(args[0]);
  String::Utf8Value name_(options->Get(NanNew<String>("name"))->ToString());
  std::string strAccount = std::string(*name_);

  if (!pwalletMain->IsLocked()) {
    pwalletMain->TopUpKeyPool();
  }

  // Generate a new key that is added to wallet
  CPubKey newKey;

  if (!pwalletMain->GetKeyFromPool(newKey)) {
    // return NanThrowError("Keypool ran out, please call keypoolrefill first");
    // EnsureWalletIsUnlocked();
    if (pwalletMain->IsLocked()) {
      return NanThrowError("Please enter the wallet passphrase with walletpassphrase first.");
    }
    pwalletMain->TopUpKeyPool(100);
    if (pwalletMain->GetKeyPoolSize() < 100) {
      return NanThrowError("Error refreshing keypool.");
    }
  }

  CKeyID keyID = newKey.GetID();

  pwalletMain->SetAddressBook(keyID, strAccount, "receive");

  NanReturnValue(NanNew<String>(CBitcoinAddress(keyID).ToString().c_str()));
}

// NOTE: This function was ripped out of the bitcoin core source. It needed to
// be modified to fit v8's error handling.
CBitcoinAddress GetAccountAddress(std::string strAccount, bool bForceNew=false) {
  CWalletDB walletdb(pwalletMain->strWalletFile);

  CAccount account;
  walletdb.ReadAccount(strAccount, account);

  bool bKeyUsed = false;

  // Check if the current key has been used
  if (account.vchPubKey.IsValid()) {
    CScript scriptPubKey = GetScriptForDestination(account.vchPubKey.GetID());
    for (map<uint256, CWalletTx>::iterator it = pwalletMain->mapWallet.begin();
         it != pwalletMain->mapWallet.end() && account.vchPubKey.IsValid();
         ++it) {
      const CWalletTx& wtx = (*it).second;
      BOOST_FOREACH(const CTxOut& txout, wtx.vout) {
        if (txout.scriptPubKey == scriptPubKey) {
          bKeyUsed = true;
        }
      }
    }
  }

  // Generate a new key
  if (!account.vchPubKey.IsValid() || bForceNew || bKeyUsed) {
    if (!pwalletMain->GetKeyFromPool(account.vchPubKey)) {
      NanThrowError("Keypool ran out, please call keypoolrefill first");
      CBitcoinAddress addr;
      return addr;
    }
    pwalletMain->SetAddressBook(account.vchPubKey.GetID(), strAccount, "receive");
    walletdb.WriteAccount(strAccount, account);
  }

  return CBitcoinAddress(account.vchPubKey.GetID());
}

/**
 * WalletGetAccountAddress()
 * bitcoindjs.walletGetAccountAddress(options)
 * Return the address tied to a specific account name.
 */

NAN_METHOD(WalletGetAccountAddress) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletGetAccountAddress(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);
  String::Utf8Value account_(options->Get(NanNew<String>("account"))->ToString());
  std::string strAccount = std::string(*account_);

  std::string ret = GetAccountAddress(strAccount).ToString();

  NanReturnValue(NanNew<String>(ret.c_str()));
}

/**
 * WalletSetAccount()
 * bitcoindjs.walletSetAccount(options)
 * Return a new address if the account does not exist, or tie an account to an
 * address.
 */

NAN_METHOD(WalletSetAccount) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSetAccount(options)");
  }

  // Parse the account first so we don't generate a key if there's an error
  Local<Object> options = Local<Object>::Cast(args[0]);
  String::Utf8Value address_(options->Get(NanNew<String>("address"))->ToString());
  std::string strAddress = std::string(*address_);

  CBitcoinAddress address(strAddress);
  if (!address.IsValid()) {
    return NanThrowError("Invalid Bitcoin address");
  }

  std::string strAccount;
  if (options->Get(NanNew<String>("account"))->IsString()) {
    String::Utf8Value account_(options->Get(NanNew<String>("account"))->ToString());
    strAccount = std::string(*account_);
  }

  // Detect when changing the account of an address that is the 'unused current key' of another account:
  if (pwalletMain->mapAddressBook.count(address.Get())) {
    string strOldAccount = pwalletMain->mapAddressBook[address.Get()].name;
    if (address == GetAccountAddress(strOldAccount)) {
      GetAccountAddress(strOldAccount, true);
    }
  }

  pwalletMain->SetAddressBook(address.Get(), strAccount, "receive");

  NanReturnValue(Undefined());
}

/**
 * WalletGetAccount()
 * bitcoindjs.walletGetAccount(options)
 * Get an account name based on address.
 */

NAN_METHOD(WalletGetAccount) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletGetAccount(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value address_(options->Get(NanNew<String>("address"))->ToString());
  std::string strAddress = std::string(*address_);

  CBitcoinAddress address(strAddress);
  if (!address.IsValid()) {
    return NanThrowError("Invalid Bitcoin address");
  }

  std::string strAccount;
  map<CTxDestination, CAddressBookData>::iterator mi = pwalletMain->mapAddressBook.find(address.Get());
  if (mi != pwalletMain->mapAddressBook.end() && !(*mi).second.name.empty()) {
    strAccount = (*mi).second.name;
  }

  NanReturnValue(NanNew<String>(strAccount.c_str()));
}

/**
 * WalletSendTo()
 * bitcoindjs.walletSendTo(options)
 * Send bitcoin to an address, automatically creating the transaction based on
 * availing unspent outputs.
 */

NAN_METHOD(WalletSendTo) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSendTo(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  async_wallet_sendto_data *data = new async_wallet_sendto_data();

  String::Utf8Value addr_(options->Get(NanNew<String>("address"))->ToString());
  std::string addr = std::string(*addr_);
  data->address = addr;

  // Amount
  int64_t nAmount = options->Get(NanNew<String>("amount"))->IntegerValue();
  data->nAmount = nAmount;

  // Wallet comments
  CWalletTx wtx;
  if (options->Get(NanNew<String>("comment"))->IsString()) {
    String::Utf8Value comment_(options->Get(NanNew<String>("comment"))->ToString());
    std::string comment = std::string(*comment_);
    wtx.mapValue["comment"] = comment;
  }
  if (options->Get(NanNew<String>("to"))->IsString()) {
    String::Utf8Value to_(options->Get(NanNew<String>("to"))->ToString());
    std::string to = std::string(*to_);
    wtx.mapValue["to"] = to;
  }
  data->wtx = wtx;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_wallet_sendto,
    (uv_after_work_cb)async_wallet_sendto_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_wallet_sendto(uv_work_t *req) {
  async_wallet_sendto_data* data = static_cast<async_wallet_sendto_data*>(req->data);

  CBitcoinAddress address(data->address);

  if (!address.IsValid()) {
    data->err_msg = std::string("Invalid Bitcoin address");
    return;
  }

  // Amount
  int64_t nAmount = data->nAmount;

  // Wallet Transaction
  CWalletTx wtx = data->wtx;

  // EnsureWalletIsUnlocked();
  if (pwalletMain->IsLocked()) {
    data->err_msg = std::string("Please enter the wallet passphrase with walletpassphrase first.");
    return;
  }

  std::string strError = pwalletMain->SendMoney(address.Get(), nAmount, wtx);
  if (strError != "") {
    data->err_msg = strError;
    return;
  }

  data->tx_hash = wtx.GetHash().GetHex();
}

static void
async_wallet_sendto_after(uv_work_t *req) {
  NanScope();
  async_wallet_sendto_data* data = static_cast<async_wallet_sendto_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(NanNew<String>(data->tx_hash))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * WalletSignMessage()
 * bitcoindjs.walletSignMessage(options)
 * Sign any piece of text using a private key tied to an address.
 */

NAN_METHOD(WalletSignMessage) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSignMessage(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value strAddress_(options->Get(NanNew<String>("address"))->ToString());
  std::string strAddress = std::string(*strAddress_);
  String::Utf8Value strMessage_(options->Get(NanNew<String>("message"))->ToString());
  std::string strMessage = std::string(*strMessage_);

  // EnsureWalletIsUnlocked();
  if (pwalletMain->IsLocked()) {
    return NanThrowError("Please enter the wallet passphrase with walletpassphrase first.");
  }

  CBitcoinAddress addr(strAddress);
  if (!addr.IsValid()) {
    return NanThrowError("Invalid address");
  }

  CKeyID keyID;
  if (!addr.GetKeyID(keyID)) {
    return NanThrowError("Address does not refer to key");
  }

  CKey key;
  if (!pwalletMain->GetKey(keyID, key)) {
    return NanThrowError("Private key not available");
  }

  CHashWriter ss(SER_GETHASH, 0);
  ss << strMessageMagic;
  ss << strMessage;

  vector<unsigned char> vchSig;
  if (!key.SignCompact(ss.GetHash(), vchSig)) {
    return NanThrowError("Sign failed");
  }

  std::string result = EncodeBase64(&vchSig[0], vchSig.size());

  NanReturnValue(NanNew<String>(result.c_str()));
}

/**
 * WalletVerifyMessage()
 * bitcoindjs.walletVerifyMessage(options)
 * Verify a signed message using any address' public key.
 */

NAN_METHOD(WalletVerifyMessage) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletVerifyMessage(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value strAddress_(options->Get(NanNew<String>("address"))->ToString());
  std::string strAddress = std::string(*strAddress_);

  String::Utf8Value strSign_(options->Get(NanNew<String>("signature"))->ToString());
  std::string strSign = std::string(*strSign_);

  String::Utf8Value strMessage_(options->Get(NanNew<String>("message"))->ToString());
  std::string strMessage = std::string(*strMessage_);

  CBitcoinAddress addr(strAddress);
  if (!addr.IsValid()) {
    return NanThrowError( "Invalid address");
  }

  CKeyID keyID;
  if (!addr.GetKeyID(keyID)) {
    return NanThrowError( "Address does not refer to key");
  }

  bool fInvalid = false;
  vector<unsigned char> vchSig = DecodeBase64(strSign.c_str(), &fInvalid);

  if (fInvalid) {
    return NanThrowError( "Malformed base64 encoding");
  }

  CHashWriter ss(SER_GETHASH, 0);
  ss << strMessageMagic;
  ss << strMessage;

  CPubKey pubkey;
  if (!pubkey.RecoverCompact(ss.GetHash(), vchSig)) {
    NanReturnValue(NanNew<Boolean>(false));
  }

  NanReturnValue(NanNew<Boolean>(pubkey.GetID() == keyID));
}

/**
 * WalletCreateMultiSigAddress()
 * bitcoindjs.walletCreateMultiSigAddress(options)
 * Create a multisig address for the global wallet.
 */

CScript _createmultisig_redeemScript(int nRequired, Local<Array> keys) {
  // Gather public keys
  if (nRequired < 1) {
    throw runtime_error("a multisignature address must require at least one key to redeem");
  }
  if ((int)keys->Length() < nRequired) {
    NanThrowError("not enough keys supplied");
    CScript s;
    return s;
  }
  std::vector<CPubKey> pubkeys;
  pubkeys.resize(keys->Length());
  for (unsigned int i = 0; i < keys->Length(); i++) {
    String::Utf8Value key_(keys->Get(i)->ToString());
    const std::string& ks = std::string(*key_);
#ifdef ENABLE_WALLET
    // Case 1: Bitcoin address and we have full public key:
    CBitcoinAddress address(ks);
    if (pwalletMain && address.IsValid()) {
      CKeyID keyID;
      if (!address.GetKeyID(keyID)) {
        NanThrowError("does not refer to a key");
        CScript s;
        return s;
      }
      CPubKey vchPubKey;
      if (!pwalletMain->GetPubKey(keyID, vchPubKey)) {
        NanThrowError("no full public key for address");
        CScript s;
        return s;
      }
      if (!vchPubKey.IsFullyValid()) {
        NanThrowError("Invalid public key");
        CScript s;
        return s;
      }
      pubkeys[i] = vchPubKey;
    }

    // Case 2: hex public key
    else
#endif
    if (IsHex(ks)) {
      CPubKey vchPubKey(ParseHex(ks));
      if (!vchPubKey.IsFullyValid()) {
        NanThrowError("Invalid public key");
        CScript s;
        return s;
      }
      pubkeys[i] = vchPubKey;
    } else {
      NanThrowError("Invalid public key");
      CScript s;
      return s;
    }
  }
  CScript result = GetScriptForMultisig(nRequired, pubkeys);

  if (result.size() > MAX_SCRIPT_ELEMENT_SIZE) {
    NanThrowError("redeemScript exceeds size limit");
    CScript s;
    return s;
  }

  return result;
}

NAN_METHOD(WalletCreateMultiSigAddress) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletCreateMultiSigAddress(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  int nRequired = options->Get(NanNew<String>("nRequired"))->IntegerValue();
  Local<Array> keys = Local<Array>::Cast(options->Get(NanNew<String>("keys")));

  // Gather public keys
  if (nRequired < 1) {
    return NanThrowError(
      "a multisignature address must require at least one key to redeem");
  }
  if ((int)keys->Length() < nRequired) {
    char s[150] = {0};
    snprintf(s, sizeof(s),
      "not enough keys supplied (got %u keys, but need at least %u to redeem)",
      keys->Length(), nRequired);
    NanThrowError(s);
    NanReturnValue(Undefined());
  }

  CScript inner = _createmultisig_redeemScript(nRequired, keys);

  // Construct using pay-to-script-hash:
  CScriptID innerID = inner.GetID();
  CBitcoinAddress address(innerID);

  Local<Object> result = NanNew<Object>();
  result->Set(NanNew<String>("address"), NanNew<String>(address.ToString()));
  result->Set(NanNew<String>("redeemScript"), NanNew<String>(HexStr(inner.begin(), inner.end())));

  NanReturnValue(result);
}

/**
 * WalletGetBalance()
 * bitcoindjs.walletGetBalance(options)
 * Get total balance of global wallet in satoshies in a javascript Number (up
 * to 64 bits, only 32 if bitwise ops or floating point are used unfortunately.
 * Obviously floating point is not necessary for satoshies).
 */

NAN_METHOD(WalletGetBalance) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletGetBalance(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  std::string strAccount = "";
  int nMinDepth = 1;

  if (options->Get(NanNew<String>("account"))->IsString()) {
    String::Utf8Value strAccount_(options->Get(NanNew<String>("account"))->ToString());
    strAccount = std::string(*strAccount_);
  }

  if (options->Get(NanNew<String>("nMinDepth"))->IsNumber()) {
    nMinDepth = options->Get(NanNew<String>("nMinDepth"))->IntegerValue();
  }

  if (strAccount == "*") {
    // Calculate total balance a different way from GetBalance()
    // (GetBalance() sums up all unspent TxOuts)
    // getbalance and getbalance '*' 0 should return the same number
    int64_t nBalance = 0;
    for (map<uint256, CWalletTx>::iterator it = pwalletMain->mapWallet.begin();
        it != pwalletMain->mapWallet.end(); ++it) {
      const CWalletTx& wtx = (*it).second;

      if (!wtx.IsTrusted() || wtx.GetBlocksToMaturity() > 0) {
        continue;
      }

      int64_t allFee;
      string strSentAccount;
      list<pair<CTxDestination, int64_t> > listReceived;
      list<pair<CTxDestination, int64_t> > listSent;
      // With v0.9.0
      // wtx.GetAmounts(listReceived, listSent, allFee, strSentAccount);
      if (wtx.GetDepthInMainChain() >= nMinDepth) {
        BOOST_FOREACH(const PAIRTYPE(CTxDestination,int64_t)& r, listReceived) {
          nBalance += r.second;
        }
      }
      BOOST_FOREACH(const PAIRTYPE(CTxDestination,int64_t)& r, listSent) {
        nBalance -= r.second;
      }
      nBalance -= allFee;
    }
    NanReturnValue(NanNew<Number>(nBalance));
  }

  double nBalance = (double)GetAccountBalance(strAccount, nMinDepth, ISMINE_SPENDABLE);
  NanReturnValue(NanNew<Number>((int64_t)(nBalance * 100000000)));
}

/**
 * WalletGetUnconfirmedBalance()
 * bitcoindjs.walletGetUnconfirmedBalance(options)
 * Returns the unconfirmed balance in satoshies (including the transactions
 * that have not yet been included in any block).
 */

NAN_METHOD(WalletGetUnconfirmedBalance) {
  NanScope();
  NanReturnValue(NanNew<Number>(pwalletMain->GetUnconfirmedBalance()));
}

/**
 * WalletSendFrom()
 * bitcoindjs.walletSendFrom(options)
 * Send bitcoin to a particular address from a particular owned account name.
 * This once again automatically creates and signs a transaction based on any
 * unspent outputs available.
 */

NAN_METHOD(WalletSendFrom) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSendFrom(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  async_wallet_sendfrom_data *data = new async_wallet_sendfrom_data();

  String::Utf8Value addr_(options->Get(NanNew<String>("address"))->ToString());
  std::string addr = std::string(*addr_);
  data->address = addr;

  String::Utf8Value from_(options->Get(NanNew<String>("from"))->ToString());
  std::string from = std::string(*from_);
  std::string strAccount = from;

  int64_t nAmount = options->Get(NanNew<String>("amount"))->IntegerValue();
  data->nAmount = nAmount;

  int nMinDepth = 1;
  if (options->Get(NanNew<String>("minDepth"))->IsNumber()) {
    nMinDepth = options->Get(NanNew<String>("minDepth"))->IntegerValue();
  }
  data->nMinDepth = nMinDepth;

  CWalletTx wtx;
  wtx.strFromAccount = strAccount;
  if (options->Get(NanNew<String>("comment"))->IsString()) {
    String::Utf8Value comment_(options->Get(NanNew<String>("comment"))->ToString());
    std::string comment = std::string(*comment_);
    wtx.mapValue["comment"] = comment;
  }
  if (options->Get(NanNew<String>("to"))->IsString()) {
    String::Utf8Value to_(options->Get(NanNew<String>("to"))->ToString());
    std::string to = std::string(*to_);
    wtx.mapValue["to"] = to;
  }
  data->wtx = wtx;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_wallet_sendfrom,
    (uv_after_work_cb)async_wallet_sendfrom_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_wallet_sendfrom(uv_work_t *req) {
  async_wallet_sendfrom_data* data = static_cast<async_wallet_sendfrom_data*>(req->data);

  CBitcoinAddress address(data->address);

  if (!address.IsValid()) {
    data->err_msg = std::string("Invalid Bitcoin address");
    return;
  }

  int64_t nAmount = data->nAmount;
  int nMinDepth = data->nMinDepth;
  CWalletTx wtx = data->wtx;
  std::string strAccount = data->wtx.strFromAccount;

  // EnsureWalletIsUnlocked();
  if (pwalletMain->IsLocked()) {
    data->err_msg = std::string("Please enter the wallet passphrase with walletpassphrase first.");
    return;
  }

  // Check funds
  double nBalance = (double)GetAccountBalance(strAccount, nMinDepth, ISMINE_SPENDABLE);
  if (((double)(nAmount * 1.0) / 100000000) > nBalance) {
    data->err_msg = std::string("Account has insufficient funds");
    return;
  }

  // Send
  std::string strError = pwalletMain->SendMoney(address.Get(), nAmount, wtx);
  if (strError != "") {
    data->err_msg = strError;
    return;
  }

  data->tx_hash = wtx.GetHash().GetHex();
}

static void
async_wallet_sendfrom_after(uv_work_t *req) {
  NanScope();
  async_wallet_sendfrom_data* data = static_cast<async_wallet_sendfrom_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(NanNew<String>(data->tx_hash))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * WalletListTransactions()
 * bitcoindjs.walletListTransactions(options)
 * List all transactions pertaining to any owned addreses. NOT YET IMPLEMENTED>
 */

NAN_METHOD(WalletListTransactions) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletListTransactions(options)");
  }

  // Local<Object> options = Local<Object>::Cast(args[0]);

  NanReturnValue(Undefined());
}

/**
 * WalletListAccounts()
 * bitcoindjs.walletListAccounts(options)
 * This will list all accounts, addresses, balanced, private keys, public keys,
 * and whether these keys are in compressed format. TODO: Only output private
 * keys if wallet is decrypted.
 */

NAN_METHOD(WalletListAccounts) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletListAccounts(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  int nMinDepth = 1;
  if (options->Get(NanNew<String>("minDepth"))->IsNumber()) {
    nMinDepth = options->Get(NanNew<String>("minDepth"))->IntegerValue();
  }

  isminefilter includeWatchonly = ISMINE_SPENDABLE;

  map<string, int64_t> mapAccountBalances;
  BOOST_FOREACH(const PAIRTYPE(CTxDestination, CAddressBookData)& entry, pwalletMain->mapAddressBook) {
    if (IsMine(*pwalletMain, entry.first) & includeWatchonly) { // This address belongs to me
      mapAccountBalances[entry.second.name] = 0;
    }
  }

  for (map<uint256, CWalletTx>::iterator it = pwalletMain->mapWallet.begin();
      it != pwalletMain->mapWallet.end(); ++it) {
    const CWalletTx& wtx = (*it).second;
    CAmount nFee;
    std::string strSentAccount;
    list<COutputEntry> listReceived;
    list<COutputEntry> listSent;
    int nDepth = wtx.GetDepthInMainChain();
    if (wtx.GetBlocksToMaturity() > 0 || nDepth < 0) {
      continue;
    }
    wtx.GetAmounts(listReceived, listSent, nFee, strSentAccount, includeWatchonly);
    mapAccountBalances[strSentAccount] -= nFee;
    BOOST_FOREACH(const COutputEntry& s, listSent) {
      mapAccountBalances[strSentAccount] -= s.amount;
    }
    if (nDepth >= nMinDepth) {
      BOOST_FOREACH(const COutputEntry& r, listReceived) {
        if (pwalletMain->mapAddressBook.count(r.destination)) {
          mapAccountBalances[pwalletMain->mapAddressBook[r.destination].name] += r.amount;
        } else {
          mapAccountBalances[""] += r.amount;
        }
      }
    }
  }

  list<CAccountingEntry> acentries;
  CWalletDB(pwalletMain->strWalletFile).ListAccountCreditDebit("*", acentries);
  BOOST_FOREACH(const CAccountingEntry& entry, acentries) {
    mapAccountBalances[entry.strAccount] += entry.nCreditDebit;
  }

  Local<Object> obj = NanNew<Object>();
  BOOST_FOREACH(const PAIRTYPE(string, int64_t)& accountBalance, mapAccountBalances) {
    Local<Object> entry = NanNew<Object>();
    entry->Set(NanNew<String>("balance"), NanNew<Number>(accountBalance.second));
    Local<Array> addr = NanNew<Array>();
    int i = 0;
    BOOST_FOREACH(const PAIRTYPE(CBitcoinAddress, CAddressBookData)& item, pwalletMain->mapAddressBook) {
      const CBitcoinAddress& address = item.first;
      const std::string& strName = item.second.name;
      if (strName == accountBalance.first) {
        Local<Object> a = NanNew<Object>();
        a->Set(NanNew<String>("address"), NanNew<String>(address.ToString()));

        CKeyID keyID;
        if (!address.GetKeyID(keyID)) {
          return NanThrowError("Address does not refer to a key");
        }
        CKey vchSecret;
        if (!pwalletMain->GetKey(keyID, vchSecret)) {
          return NanThrowError("Private key for address is not known");
        }
        std::string priv = CBitcoinSecret(vchSecret).ToString();
        a->Set(NanNew<String>("privkeycompressed"), NanNew<Boolean>(vchSecret.IsCompressed()));
        a->Set(NanNew<String>("privkey"), NanNew<String>(priv));

        CPubKey vchPubKey;
        pwalletMain->GetPubKey(keyID, vchPubKey);
        a->Set(NanNew<String>("pubkeycompressed"), NanNew<Boolean>(vchPubKey.IsCompressed()));
        a->Set(NanNew<String>("pubkey"), NanNew<String>(HexStr(vchPubKey)));

        addr->Set(i, a);
        i++;
      }
    }
    entry->Set(NanNew<String>("addresses"), addr);
    obj->Set(NanNew<String>(accountBalance.first), entry);
  }

  NanReturnValue(obj);
}

/**
 * WalletGetTransaction()
 * bitcoindjs.walletGetTransaction(options)
 * Get any transaction pertaining to any owned addresses. NOT YET IMPLEMENTED.
 */

NAN_METHOD(WalletGetTransaction) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletGetTransaction(options)");
  }

  // Local<Object> options = Local<Object>::Cast(args[0]);

  NanReturnValue(Undefined());
}

/**
 * WalletBackup()
 * bitcoindjs.walletBackup(options)
 * Backup the bdb wallet.dat to a particular location on filesystem.
 */

NAN_METHOD(WalletBackup) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletBackup(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value path_(options->Get(NanNew<String>("path"))->ToString());
  std::string strDest = std::string(*path_);

  if (!BackupWallet(*pwalletMain, strDest)) {
    return NanThrowError("Error: Wallet backup failed!");
  }

  NanReturnValue(Undefined());
}

/**
 * WalletPassphrase()
 * bitcoindjs.walletPassphrase(options)
 * Unlock wallet if encrypted already.
 */

NAN_METHOD(WalletPassphrase) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletPassphrase(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value passphrase_(options->Get(NanNew<String>("passphrase"))->ToString());
  std::string strPassphrase = std::string(*passphrase_);

  if (!pwalletMain->IsCrypted()) {
    return NanThrowError("Error: running with an unencrypted wallet, but walletpassphrase was called.");
  }

  SecureString strWalletPass;
  strWalletPass.reserve(100);
  strWalletPass = strPassphrase.c_str();

  if (strWalletPass.length() > 0) {
    if (!pwalletMain->Unlock(strWalletPass)) {
      return NanThrowError("Error: The wallet passphrase entered was incorrect.");
    }
  } else {
    return NanThrowError(
      "walletpassphrase <passphrase> <timeout>\n"
      "Stores the wallet decryption key in memory for <timeout> seconds.");
  }

  pwalletMain->TopUpKeyPool();

  NanReturnValue(Undefined());
}

/**
 * WalletPassphraseChange()
 * bitcoindjs.walletPassphraseChange(options)
 * Change the current passphrase for the encrypted wallet.
 */

NAN_METHOD(WalletPassphraseChange) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletPassphraseChange(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value oldPass_(options->Get(NanNew<String>("oldPass"))->ToString());
  std::string oldPass = std::string(*oldPass_);

  String::Utf8Value newPass_(options->Get(NanNew<String>("newPass"))->ToString());
  std::string newPass = std::string(*newPass_);

  if (!pwalletMain->IsCrypted()) {
    return NanThrowError("Error: running with an unencrypted wallet, but walletpassphrasechange was called.");
  }

  SecureString strOldWalletPass;
  strOldWalletPass.reserve(100);
  strOldWalletPass = oldPass.c_str();

  SecureString strNewWalletPass;
  strNewWalletPass.reserve(100);
  strNewWalletPass = newPass.c_str();

  if (strOldWalletPass.length() < 1 || strNewWalletPass.length() < 1) {
    return NanThrowError(
      "walletpassphrasechange <oldpassphrase> <newpassphrase>\n"
      "Changes the wallet passphrase from <oldpassphrase> to <newpassphrase>.");
  }

  if (!pwalletMain->ChangeWalletPassphrase(strOldWalletPass, strNewWalletPass)) {
    return NanThrowError("Error: The wallet passphrase entered was incorrect.");
  }

  NanReturnValue(Undefined());
}

/**
 * WalletLock()
 * bitcoindjs.walletLock(options)
 * Forget the encrypted wallet passphrase and lock the wallet once again.
 */

NAN_METHOD(WalletLock) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletLock(options)");
  }

  // Local<Object> options = Local<Object>::Cast(args[0]);

  if (!pwalletMain->IsCrypted()) {
    return NanThrowError("Error: running with an unencrypted wallet, but walletlock was called.");
  }

  pwalletMain->Lock();

  NanReturnValue(Undefined());
}

/**
 * WalletEncrypt()
 * bitcoindjs.walletEncrypt(options)
 * Encrypt the global wallet with a particular passphrase. Requires restarted
 * because Berkeley DB is bad.
 */

NAN_METHOD(WalletEncrypt) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletEncrypt(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  String::Utf8Value passphrase_(options->Get(NanNew<String>("passphrase"))->ToString());
  std::string strPass = std::string(*passphrase_);

  if (pwalletMain->IsCrypted()) {
    return NanThrowError("Error: running with an encrypted wallet, but encryptwallet was called.");
  }

  SecureString strWalletPass;
  strWalletPass.reserve(100);
  strWalletPass = strPass.c_str();

  if (strWalletPass.length() < 1) {
    return NanThrowError(
      "encryptwallet <passphrase>\n"
      "Encrypts the wallet with <passphrase>.");
  }

  if (!pwalletMain->EncryptWallet(strWalletPass)) {
    return NanThrowError("Error: Failed to encrypt the wallet.");
  }

  // BDB seems to have a bad habit of writing old data into
  // slack space in .dat files; that is bad if the old data is
  // unencrypted private keys. So:
  StartShutdown();

  printf(
    "bitcoind.js:"
    " wallet encrypted; bitcoind.js stopping,"
    " restart to run with encrypted wallet."
    " The keypool has been flushed, you need"
    " to make a new backup.\n"
  );

  NanReturnValue(Undefined());
}

/**
 * WalletSetTxFee()
 * bitcoindjs.walletSetTxFee(options)
 * Set default global wallet transaction fee internally.
 */

NAN_METHOD(WalletSetTxFee) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSetTxFee(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  int64_t fee = options->Get(NanNew<String>("fee"))->IntegerValue();

  // Amount
  CAmount nAmount = 0;
  if (fee != 0.0) {
    nAmount = fee;
  }

  payTxFee = CFeeRate(nAmount, 1000);

  NanReturnValue(True());
}

/**
 * WalletImportKey()
 * bitcoindjs.walletImportKey(options)
 * Import private key into global wallet using standard compressed bitcoind
 * format.
 */

NAN_METHOD(WalletImportKey) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletImportKey(options, callback)");
  }

  async_import_key_data *data = new async_import_key_data();

  Local<Object> options = Local<Object>::Cast(args[0]);
  Local<Function> callback;

  if (args.Length() > 1 && args[1]->IsFunction()) {
    callback = Local<Function>::Cast(args[1]);
    data->callback = Persistent<Function>::New(callback);
  }

  std::string strSecret = "";
  std::string strLabel = "";

  String::Utf8Value key_(options->Get(NanNew<String>("key"))->ToString());
  strSecret = std::string(*key_);

  if (options->Get(NanNew<String>("label"))->IsString()) {
    String::Utf8Value label_(options->Get(NanNew<String>("label"))->ToString());
    strLabel = std::string(*label_);
  }

  // EnsureWalletIsUnlocked();
  if (pwalletMain->IsLocked()) {
    return NanThrowError("Please enter the wallet passphrase with walletpassphrase first.");
  }

  // Whether to perform rescan after import
  // data->fRescan = true;
  data->fRescan = args.Length() > 1 && args[1]->IsFunction() ? true : false;

  // if (options->Get(NanNew<String>("rescan"))->IsBoolean()
  //     && options->Get(NanNew<String>("rescan"))->IsFalse()) {
  //   data->fRescan = false;
  // }

  CBitcoinSecret vchSecret;
  bool fGood = vchSecret.SetString(strSecret);

  if (!fGood) {
    return NanThrowError("Invalid private key encoding");
  }

  CKey key = vchSecret.GetKey();
  if (!key.IsValid()) {
    return NanThrowError("Private key outside allowed range");
  }

  CPubKey pubkey = key.GetPubKey();
  CKeyID vchAddress = pubkey.GetID();
  {
    LOCK2(cs_main, pwalletMain->cs_wallet);

    pwalletMain->MarkDirty();
    pwalletMain->SetAddressBook(vchAddress, strLabel, "receive");

    // Don't throw error in case a key is already there
    if (pwalletMain->HaveKey(vchAddress)) {
      NanReturnValue(Undefined());
    }

    pwalletMain->mapKeyMetadata[vchAddress].nCreateTime = 1;

    if (!pwalletMain->AddKeyPubKey(key, pubkey)) {
      return NanThrowError("Error adding key to wallet");
    }

    // whenever a key is imported, we need to scan the whole chain
    pwalletMain->nTimeFirstKey = 1; // 0 would be considered 'no value'

    // Do this on the threadpool instead.
    // if (data->fRescan) {
    //   pwalletMain->ScanForWalletTransactions(chainActive.Genesis(), true);
    // }
  }

  if (data->fRescan) {
    uv_work_t *req = new uv_work_t();
    req->data = data;

    int status = uv_queue_work(uv_default_loop(),
      req, async_import_key,
      (uv_after_work_cb)async_import_key_after);

    assert(status == 0);
  }

  NanReturnValue(Undefined());
}

static void
async_import_key(uv_work_t *req) {
  async_import_key_data* data = static_cast<async_import_key_data*>(req->data);
  if (data->fRescan) {
    // This may take a long time, do it on the libuv thread pool:
    pwalletMain->ScanForWalletTransactions(chainActive.Genesis(), true);
  }
}

static void
async_import_key_after(uv_work_t *req) {
  NanScope();
  async_import_key_data* data = static_cast<async_import_key_data*>(req->data);

  if (!data->err_msg.empty()) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(Null())
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * Conversions
 *   cblock_to_jsblock(cblock, cblock_index, jsblock)
 *   ctx_to_jstx(ctx, block_hash, jstx)
 *   jsblock_to_cblock(jsblock, cblock)
 *   jstx_to_ctx(jstx, ctx)
 * These functions, only callable from C++, are used to convert javascript
 * blocks and tx objects to bitcoin block and tx objects (CBlocks and
 * CTransactions), and vice versa.
 */

static inline void
cblock_to_jsblock(const CBlock& cblock, const CBlockIndex* cblock_index, Local<Object> jsblock) {
  jsblock->Set(NanNew<String>("hash"), NanNew<String>(cblock.GetHash().GetHex().c_str()));
  CMerkleTx txGen(cblock.vtx[0]);
  txGen.SetMerkleBranch(cblock);
  jsblock->Set(NanNew<String>("confirmations"), NanNew<Number>((int)txGen.GetDepthInMainChain())->ToInt32());
  jsblock->Set(NanNew<String>("size"),
    NanNew<Number>((int)::GetSerializeSize(cblock, SER_NETWORK, PROTOCOL_VERSION))->ToInt32());
  jsblock->Set(NanNew<String>("height"), NanNew<Number>(cblock_index->nHeight));
  jsblock->Set(NanNew<String>("version"), NanNew<Number>(cblock.nVersion));
  jsblock->Set(NanNew<String>("merkleroot"), NanNew<String>(cblock.hashMerkleRoot.GetHex()));

  // Build merkle tree
  if (cblock.vMerkleTree.empty()) {
    cblock.BuildMerkleTree();
  }
  Local<Array> merkle = NanNew<Array>();
  int mi = 0;
  BOOST_FOREACH(uint256& hash, cblock.vMerkleTree) {
    merkle->Set(mi, NanNew<String>(hash.ToString()));
    mi++;
  }
  jsblock->Set(NanNew<String>("merkletree"), merkle);

  Local<Array> txs = NanNew<Array>();
  int ti = 0;
  BOOST_FOREACH(const CTransaction& ctx, cblock.vtx) {
    Local<Object> jstx = NanNew<Object>();
    const uint256 block_hash = cblock.GetHash();
    ctx_to_jstx(ctx, block_hash, jstx);
    txs->Set(ti, jstx);
    ti++;
  }
  jsblock->Set(NanNew<String>("tx"), txs);

  jsblock->Set(NanNew<String>("time"), NanNew<Number>((unsigned int)cblock.GetBlockTime())->ToUint32());
  jsblock->Set(NanNew<String>("nonce"), NanNew<Number>((unsigned int)cblock.nNonce)->ToUint32());
  jsblock->Set(NanNew<String>("bits"), NanNew<Number>((unsigned int)cblock.nBits)->ToUint32());
  jsblock->Set(NanNew<String>("difficulty"), NanNew<Number>(GetDifficulty(cblock_index)));
  jsblock->Set(NanNew<String>("chainwork"), NanNew<String>(cblock_index->nChainWork.GetHex()));

  if (cblock_index->pprev) {
    jsblock->Set(NanNew<String>("previousblockhash"), NanNew<String>(cblock_index->pprev->GetBlockHash().GetHex()));
  } else {
    // genesis
    jsblock->Set(NanNew<String>("previousblockhash"),
      NanNew<String>("0000000000000000000000000000000000000000000000000000000000000000"));
  }

  CBlockIndex *pnext = chainActive.Next(cblock_index);
  if (pnext) {
    jsblock->Set(NanNew<String>("nextblockhash"), NanNew<String>(pnext->GetBlockHash().GetHex()));
  }

  CDataStream ssBlock(SER_NETWORK, PROTOCOL_VERSION);
  ssBlock << cblock;
  std::string strHex = HexStr(ssBlock.begin(), ssBlock.end());
  jsblock->Set(NanNew<String>("hex"), NanNew<String>(strHex));
}

static inline void
ctx_to_jstx(const CTransaction& ctx, uint256 block_hash, Local<Object> jstx) {
  // With v0.9.0
  // jstx->Set(NanNew<String>("mintxfee"), NanNew<Number>((int64_t)ctx.nMinTxFee)->ToInteger());
  // jstx->Set(NanNew<String>("minrelaytxfee"), NanNew<Number>((int64_t)ctx.nMinRelayTxFee)->ToInteger());
  jstx->Set(NanNew<String>("current_version"), NanNew<Number>((int)ctx.CURRENT_VERSION)->ToInt32());

  jstx->Set(NanNew<String>("txid"), NanNew<String>(ctx.GetHash().GetHex()));
  jstx->Set(NanNew<String>("version"), NanNew<Number>((int)ctx.nVersion)->ToInt32());
  jstx->Set(NanNew<String>("locktime"), NanNew<Number>((unsigned int)ctx.nLockTime)->ToUint32());

  Local<Array> vin = NanNew<Array>();
  int vi = 0;
  BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
    Local<Object> in = NanNew<Object>();

    //if (ctx.IsCoinBase()) {
    //  in->Set(NanNew<String>("coinbase"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    //  in->Set(NanNew<String>("txid"), NanNew<String>(txin.prevout.hash.GetHex()));
    //  in->Set(NanNew<String>("vout"), NanNew<Number>((unsigned int)0)->ToUint32());
    //  Local<Object> o = NanNew<Object>();
    //  o->Set(NanNew<String>("asm"), NanNew<String>(txin.scriptSig.ToString()));
    //  o->Set(NanNew<String>("hex"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    //  in->Set(NanNew<String>("scriptSig"), o);
    //} else {
    if (ctx.IsCoinBase()) {
      in->Set(NanNew<String>("coinbase"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    }
    in->Set(NanNew<String>("txid"), NanNew<String>(txin.prevout.hash.GetHex()));
    in->Set(NanNew<String>("vout"), NanNew<Number>((unsigned int)txin.prevout.n)->ToUint32());
    Local<Object> o = NanNew<Object>();
    o->Set(NanNew<String>("asm"), NanNew<String>(txin.scriptSig.ToString()));
    o->Set(NanNew<String>("hex"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    in->Set(NanNew<String>("scriptSig"), o);
    //}

    in->Set(NanNew<String>("sequence"), NanNew<Number>((unsigned int)txin.nSequence)->ToUint32());

    vin->Set(vi, in);
    vi++;
  }
  jstx->Set(NanNew<String>("vin"), vin);

  Local<Array> vout = NanNew<Array>();
  for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
    const CTxOut& txout = ctx.vout[vo];
    Local<Object> out = NanNew<Object>();

    out->Set(NanNew<String>("value"), NanNew<Number>((int64_t)txout.nValue)->ToInteger());
    out->Set(NanNew<String>("n"), NanNew<Number>((unsigned int)vo)->ToUint32());

    Local<Object> o = NanNew<Object>();
    {
      const CScript& scriptPubKey = txout.scriptPubKey;
      Local<Object> out = o;

      txnouttype type;
      vector<CTxDestination> addresses;
      int nRequired;
      out->Set(NanNew<String>("asm"), NanNew<String>(scriptPubKey.ToString()));
      out->Set(NanNew<String>("hex"), NanNew<String>(HexStr(scriptPubKey.begin(), scriptPubKey.end())));
      if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
        out->Set(NanNew<String>("type"), NanNew<String>(GetTxnOutputType(type)));
      } else {
        out->Set(NanNew<String>("reqSigs"), NanNew<Number>((int)nRequired)->ToInt32());
        out->Set(NanNew<String>("type"), NanNew<String>(GetTxnOutputType(type)));
        Local<Array> a = NanNew<Array>();
        int ai = 0;
        BOOST_FOREACH(const CTxDestination& addr, addresses) {
          a->Set(ai, NanNew<String>(CBitcoinAddress(addr).ToString()));
          ai++;
        }
        out->Set(NanNew<String>("addresses"), a);
      }
    }
    out->Set(NanNew<String>("scriptPubKey"), o);

    vout->Set(vo, out);
  }
  jstx->Set(NanNew<String>("vout"), vout);

  if (block_hash != 0) {
    jstx->Set(NanNew<String>("blockhash"), NanNew<String>(block_hash.GetHex()));
    CWalletTx cwtx(pwalletMain, ctx);
    int confirms = cwtx.GetDepthInMainChain();
    jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(confirms));
    if (ctx.IsCoinBase()) {
      jstx->Set(NanNew<String>("generated"), NanNew<Boolean>(true));
    }
    if (confirms > 0) {
      jstx->Set(NanNew<String>("blockhash"), NanNew<String>(cwtx.hashBlock.GetHex()));
      jstx->Set(NanNew<String>("blockindex"), NanNew<Number>(cwtx.nIndex));
      jstx->Set(NanNew<String>("blocktime"), NanNew<Number>(mapBlockIndex[cwtx.hashBlock]->GetBlockTime()));
    }
    Local<Array> conflicts = NanNew<Array>();
    int co = 0;
    BOOST_FOREACH(const uint256& conflict, cwtx.GetConflicts()) {
      conflicts->Set(co++, NanNew<String>(conflict.GetHex()));
    }
    jstx->Set(NanNew<String>("walletconflicts"), conflicts);
    jstx->Set(NanNew<String>("time"), NanNew<Number>(cwtx.GetTxTime()));
    jstx->Set(NanNew<String>("timereceived"), NanNew<Number>((int64_t)cwtx.nTimeReceived));
  }

  CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
  ssTx << ctx;
  std::string strHex = HexStr(ssTx.begin(), ssTx.end());
  jstx->Set(NanNew<String>("hex"), NanNew<String>(strHex));
}

static inline void
jsblock_to_cblock(const Local<Object> jsblock, CBlock& cblock) {
  cblock.nVersion = (int)jsblock->Get(NanNew<String>("version"))->Int32Value();

  String::AsciiValue mhash__(jsblock->Get(NanNew<String>("merkleroot"))->ToString());
  std::string mhash_ = *mhash__;
  uint256 mhash(mhash_);

  cblock.hashMerkleRoot = mhash;
  cblock.nTime = (unsigned int)jsblock->Get(NanNew<String>("time"))->Uint32Value();
  cblock.nNonce = (unsigned int)jsblock->Get(NanNew<String>("nonce"))->Uint32Value();
  cblock.nBits = (unsigned int)jsblock->Get(NanNew<String>("bits"))->Uint32Value();

  if (jsblock->Get(NanNew<String>("previousblockhash"))->IsString()) {
    String::AsciiValue hash__(jsblock->Get(NanNew<String>("previousblockhash"))->ToString());
    std::string hash_ = *hash__;
    uint256 hash(hash_);
    cblock.hashPrevBlock = hash;
  } else {
    // genesis block
    cblock.hashPrevBlock = uint256(0);
  }

  Local<Array> txs = Local<Array>::Cast(jsblock->Get(NanNew<String>("tx")));
  for (unsigned int ti = 0; ti < txs->Length(); ti++) {
    Local<Object> jstx = Local<Object>::Cast(txs->Get(ti));
    CTransaction ctx;
    jstx_to_ctx(jstx, ctx);
    cblock.vtx.push_back(ctx);
  }

  if (cblock.vMerkleTree.empty()) {
    cblock.BuildMerkleTree();
  }
}

// NOTE: For whatever reason when converting a jstx to a CTransaction via
// setting CTransaction properties, the binary output of a jstx is not the same
// as what went in. It is unknow why this occurs. For now we are are using a
// workaround by carrying the original hex value on the object which is changed
// when the tx is changed.
static inline void
jstx_to_ctx(const Local<Object> jstx, CTransaction& ctx_) {
  String::AsciiValue hex_string_(jstx->Get(NanNew<String>("hex"))->ToString());
  std::string hex_string = *hex_string_;

  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> ctx_;
  } catch (std::exception &e) {
    NanThrowError("Bad TX decode");
  }

  return;

  CMutableTransaction& ctx = (CMutableTransaction&)ctx_;

  // With v0.9.0
  // ctx.nMinTxFee = (int64_t)jstx->Get(NanNew<String>("mintxfee"))->IntegerValue();
  // ctx.nMinRelayTxFee = (int64_t)jstx->Get(NanNew<String>("minrelaytxfee"))->IntegerValue();

  // ctx.CURRENT_VERSION = (unsigned int)jstx->Get(NanNew<String>("current_version"))->Int32Value();

  ctx.nVersion = (int)jstx->Get(NanNew<String>("version"))->Int32Value();

  Local<Array> vin = Local<Array>::Cast(jstx->Get(NanNew<String>("vin")));
  for (unsigned int vi = 0; vi < vin->Length(); vi++) {
    CTxIn txin;

    Local<Object> in = Local<Object>::Cast(vin->Get(vi));

    //if (ctx.IsCoinBase()) {
    //  txin.prevout.hash = uint256(0);
    //  txin.prevout.n = (unsigned int)0;
    //} else {
      String::AsciiValue phash__(in->Get(NanNew<String>("txid"))->ToString());
      std::string phash_ = *phash__;
      uint256 phash(phash_);

      txin.prevout.hash = phash;
      txin.prevout.n = (unsigned int)in->Get(NanNew<String>("vout"))->Uint32Value();
    //}

    std::string shash_;
    Local<Object> script_obj = Local<Object>::Cast(in->Get(NanNew<String>("scriptSig")));
    String::AsciiValue shash__(script_obj->Get(NanNew<String>("hex"))->ToString());
    shash_ = *shash__;
    uint256 shash(shash_);
    CScript scriptSig(shash);

    txin.scriptSig = scriptSig;
    txin.nSequence = (unsigned int)in->Get(NanNew<String>("sequence"))->Uint32Value();

    ctx.vin.push_back(txin);
  }

  Local<Array> vout = Local<Array>::Cast(jstx->Get(NanNew<String>("vout")));
  for (unsigned int vo = 0; vo < vout->Length(); vo++) {
    CTxOut txout;

    Local<Object> out = Local<Object>::Cast(vout->Get(vo));

    int64_t nValue = (int64_t)out->Get(NanNew<String>("value"))->IntegerValue();
    txout.nValue = nValue;

    Local<Object> script_obj = Local<Object>::Cast(out->Get(NanNew<String>("scriptPubKey")));
    String::AsciiValue phash__(script_obj->Get(NanNew<String>("hex")));
    std::string phash_ = *phash__;
    uint256 phash(phash_);
    CScript scriptPubKey(phash);

    txout.scriptPubKey = scriptPubKey;

    ctx.vout.push_back(txout);
  }

  ctx.nLockTime = (unsigned int)jstx->Get(NanNew<String>("locktime"))->Uint32Value();
}

/**
 * Init()
 * Initialize the singleton object known as bitcoindjs.
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();

  NODE_SET_METHOD(target, "start", StartBitcoind);
  NODE_SET_METHOD(target, "stop", StopBitcoind);
  NODE_SET_METHOD(target, "stopping", IsStopping);
  NODE_SET_METHOD(target, "stopped", IsStopped);
  NODE_SET_METHOD(target, "getBlock", GetBlock);
  NODE_SET_METHOD(target, "getTx", GetTx);
  NODE_SET_METHOD(target, "pollBlocks", PollBlocks);
  NODE_SET_METHOD(target, "pollMempool", PollMempool);
  NODE_SET_METHOD(target, "broadcastTx", BroadcastTx);
  NODE_SET_METHOD(target, "verifyBlock", VerifyBlock);
  NODE_SET_METHOD(target, "verifyTransaction", VerifyTransaction);
  NODE_SET_METHOD(target, "fillTransaction", FillTransaction);
  NODE_SET_METHOD(target, "getInfo", GetInfo);
  NODE_SET_METHOD(target, "getPeerInfo", GetPeerInfo);
  NODE_SET_METHOD(target, "getBlockHex", GetBlockHex);
  NODE_SET_METHOD(target, "getTxHex", GetTxHex);
  NODE_SET_METHOD(target, "blockFromHex", BlockFromHex);
  NODE_SET_METHOD(target, "txFromHex", TxFromHex);

  NODE_SET_METHOD(target, "walletNewAddress", WalletNewAddress);
  NODE_SET_METHOD(target, "walletGetAccountAddress", WalletGetAccountAddress);
  NODE_SET_METHOD(target, "walletSetAccount", WalletSetAccount);
  NODE_SET_METHOD(target, "walletGetAccount", WalletGetAccount);
  NODE_SET_METHOD(target, "walletSendTo", WalletSendTo);
  NODE_SET_METHOD(target, "walletSignMessage", WalletSignMessage);
  NODE_SET_METHOD(target, "walletVerifyMessage", WalletVerifyMessage);
  NODE_SET_METHOD(target, "walletGetBalance", WalletGetBalance);
  NODE_SET_METHOD(target, "walletCreateMultiSigAddress", WalletCreateMultiSigAddress);
  NODE_SET_METHOD(target, "walletGetUnconfirmedBalance", WalletGetUnconfirmedBalance);
  NODE_SET_METHOD(target, "walletSendFrom", WalletSendFrom);
  NODE_SET_METHOD(target, "walletListTransactions", WalletListTransactions);
  NODE_SET_METHOD(target, "walletListAccounts", WalletListAccounts);
  NODE_SET_METHOD(target, "walletGetTransaction", WalletGetTransaction);
  NODE_SET_METHOD(target, "walletBackup", WalletBackup);
  NODE_SET_METHOD(target, "walletPassphrase", WalletPassphrase);
  NODE_SET_METHOD(target, "walletPassphraseChange", WalletPassphraseChange);
  NODE_SET_METHOD(target, "walletLock", WalletLock);
  NODE_SET_METHOD(target, "walletEncrypt", WalletEncrypt);
  NODE_SET_METHOD(target, "walletSetTxFee", WalletSetTxFee);
  NODE_SET_METHOD(target, "walletImportKey", WalletImportKey);
}

NODE_MODULE(bitcoindjs, init)
