/**
 * bitcoind.js
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

#if defined(HAVE_CONFIG_H)
#include "bitcoin-config.h"
#endif

#include "core.h"
#include "addrman.h"
#include "checkpoints.h"
#include "crypter.h"
#include "main.h"
// #include "random.h"
// #include "timedata.h"

#ifdef ENABLE_WALLET
#include "db.h"
#include "wallet.h"
#include "walletdb.h"
#endif

// #include "walletdb.h"
#include "alert.h"
#include "checkqueue.h"
// #include "db.h"
#include "miner.h"
#include "rpcclient.h"
#include "tinyformat.h"
// #include "wallet.h"
#include "allocators.h"
#include "clientversion.h"
#include "hash.h"
#include "mruset.h"
#include "rpcprotocol.h"
#include "txdb.h"
#include "base58.h"
#include "coincontrol.h"
#include "init.h"
#include "netbase.h"
#include "rpcserver.h"
#include "rpcwallet.h"
#include "txmempool.h"
#include "bloom.h"
#include "coins.h"
#include "key.h"
#include "net.h"
#include "script.h"
#include "ui_interface.h"
// #include "chainparamsbase.h"
#include "compat.h"
#include "keystore.h"
#include "noui.h"
#include "serialize.h"
#include "uint256.h"
#include "chainparams.h"
#include "core.h"
#include "leveldbwrapper.h"
// #include "pow.h"
#include "sync.h"
#include "util.h"
// #include "chainparamsseeds.h"
// #include "core_io.h"
#include "limitedmap.h"
#include "protocol.h"
#include "threadsafety.h"
#include "version.h"

/**
 * Bitcoin Globals
 * Relevant:
 *  ~/bitcoin/src/init.cpp
 *  ~/bitcoin/src/bitcoind.cpp
 *  ~/bitcoin/src/main.h
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

extern void DetectShutdownThread(boost::thread_group*);
extern int nScriptCheckThreads;
extern bool fDaemon;
extern std::map<std::string, std::string> mapArgs;
#ifdef ENABLE_WALLET
extern std::string strWalletFile;
extern CWallet *pwalletMain;
#endif
extern int64_t nTransactionFee;
extern const std::string strMessageMagic;

/**
 * Node and Templates
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

Handle<Object> bitcoindjs_obj;

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

static void
async_start_node_work(uv_work_t *req);

static void
async_start_node_after(uv_work_t *req);

static void
async_stop_node_work(uv_work_t *req);

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
 * Private Variables
 */

static volatile bool shutdownComplete = false;
static int block_poll_top_height = -1;

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_node_data {
  std::string err_msg;
  std::string result;
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
  CTransaction result_tx;
  Persistent<Function> callback;
};

/**
 * async_poll_blocks_data
 */

typedef struct _poll_blocks_list {
  CBlock cblock;
  CBlockIndex *cblock_index;
  struct _poll_blocks_list *next;
} poll_blocks_list;

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
  std::string tx_hex;
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
 * StartBitcoind
 * bitcoind.start(callback)
 */

NAN_METHOD(StartBitcoind) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoind.start(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  //
  // Run bitcoind's StartNode() on a separate thread.
  //

  async_node_data *data = new async_node_data();
  data->err_msg = std::string("");
  data->result = std::string("");
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_start_node_work,
    (uv_after_work_cb)async_start_node_after);

  assert(status == 0);

  NanReturnValue(NanNew<Number>(-1));
}

/**
 * async_start_node_work()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node_work(uv_work_t *req) {
  async_node_data *data = static_cast<async_node_data*>(req->data);
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

  // data->callback.Dispose();

  delete data;
  delete req;
}

/**
 * IsStopping()
 * bitcoind.stopping()
 */

NAN_METHOD(IsStopping) {
  NanScope();
  NanReturnValue(NanNew<Boolean>(ShutdownRequested()));
}

/**
 * IsStopped()
 * bitcoind.stopped()
 */

NAN_METHOD(IsStopped) {
  NanScope();
  NanReturnValue(NanNew<Boolean>(shutdownComplete));
}

/**
 * start_node(void)
 * start_node_thread(void)
 * A reimplementation of AppInit2 minus
 * the logging and argument parsing.
 */

static int
start_node(void) {
  noui_connect();

  (boost::thread *)new boost::thread(boost::bind(&start_node_thread));

  // wait for wallet to be instantiated
  // this also avoids a race condition with signals not being set up
  while (!pwalletMain) {
    useconds_t usec = 100 * 1000;
    usleep(usec);
  }

  // drop the bitcoind signal handlers - we want our own
  signal(SIGINT, SIG_DFL);
  signal(SIGHUP, SIG_DFL);
  signal(SIGQUIT, SIG_DFL);

  return 0;
}

static void
start_node_thread(void) {
  boost::thread_group threadGroup;
  boost::thread *detectShutdownThread = NULL;

  const int argc = 0;
  const char *argv[argc + 1] = {
    //"-server",
    NULL
  };
  ParseParameters(argc, argv);
  ReadConfigFile(mapArgs, mapMultiArgs);
  if (!SelectParamsFromCommandLine()) {
    return;
  }
  // CreatePidFile(GetPidFile(), getpid());
  detectShutdownThread = new boost::thread(
    boost::bind(&DetectShutdownThread, &threadGroup));

  int fRet = AppInit2(threadGroup);

  if (!fRet) {
    if (detectShutdownThread)
      detectShutdownThread->interrupt();
    threadGroup.interrupt_all();
  }

  if (detectShutdownThread) {
    detectShutdownThread->join();
    delete detectShutdownThread;
    detectShutdownThread = NULL;
  }
  Shutdown();
  shutdownComplete = true;
}

/**
 * StopBitcoind
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
    req, async_stop_node_work,
    (uv_after_work_cb)async_stop_node_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

/**
 * async_stop_node_work()
 * Call StartShutdown() to join the boost threads, which will call Shutdown().
 */

static void
async_stop_node_work(uv_work_t *req) {
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
 * GetBlock
 * bitcoind.getBlock(blockHash, callback)
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
  if (strHash[1] != 'x') {
    strHash = "0x" + strHash;
  }
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
 * GetTx
 * bitcoind.getTx(txHash, [blockHash], callback)
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

  if (txHash[1] != 'x') {
    txHash = "0x" + txHash;
  }

  if (blockHash[1] != 'x') {
    blockHash = "0x" + blockHash;
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
    data->result_tx = ctx;
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
  CTransaction ctx = data->result_tx;

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
    CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
    ssTx << ctx;
    std::string strHex = HexStr(ssTx.begin(), ssTx.end());

    Local<Object> jstx = NanNew<Object>();
    jstx->Set(NanNew<String>("hex"), NanNew<String>(strHex));
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
 * PollBlocks
 * bitcoind.pollBlocks(callback)
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
 * PollMempool
 * bitcoind.pollMempool(callback)
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
 * BroadcastTx
 * bitcoind.broadcastTx(tx, override_fees, own_only, callback)
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

  String::Utf8Value tx_hex_(jstx->Get(NanNew<String>("hex"))->ToString());
  std::string tx_hex = std::string(*tx_hex_);

  async_broadcast_tx_data *data = new async_broadcast_tx_data();
  data->tx_hex = tx_hex;
  data->override_fees = args[1]->ToBoolean()->IsTrue();
  data->own_only = args[2]->ToBoolean()->IsTrue();
  data->err_msg = std::string("");
  data->callback = Persistent<Function>::New(callback);

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

  CDataStream ssData(ParseHex(data->tx_hex), SER_NETWORK, PROTOCOL_VERSION);
  CTransaction ctx;

  bool fOverrideFees = false;
  bool fOwnOnly = false;

  if (data->override_fees) {
    fOverrideFees = true;
  }

  if (data->own_only) {
    fOwnOnly = true;
  }

  // jstx_to_ctx(jstx, ctx);

  try {
    ssData >> ctx;
  } catch (std::exception &e) {
    data->err_msg = std::string("TX decode failed");
    return;
  }

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
    SyncWithWallets(hashTx, ctx, NULL);
  }

  RelayTransaction(ctx, hashTx);

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
    // jstx_to_ctx(jstx, ctx);
    CDataStream ssData(ParseHex(data->tx_hex), SER_NETWORK, PROTOCOL_VERSION);
    CTransaction ctx;
    ssData >> ctx;
    Local<Object> jstx = NanNew<Object>();
    ctx_to_jstx(ctx, 0, jstx);

    const unsigned argc = 3;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(NanNew<String>(data->tx_hash)),
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
 * VerifyBlock
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

  // jsblock_to_cblock(jsblock, cblock);
  CBlock cblock;
  CDataStream ssData(ParseHex(block_hex), SER_NETWORK, PROTOCOL_VERSION);
  ssData >> cblock;

  CValidationState state;
  bool valid = CheckBlock(cblock, state);

  NanReturnValue(NanNew<Boolean>(valid));
}

/**
 * VerifyTransaction
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

  // jstx_to_ctx(jstx, ctx);
  CTransaction ctx;
  CDataStream ssData(ParseHex(tx_hex), SER_NETWORK, PROTOCOL_VERSION);
  ssData >> ctx;

  CValidationState state;
  bool valid = CheckTransaction(ctx, state);

  std::string reason;
  bool standard = IsStandardTx(ctx, reason);

  NanReturnValue(NanNew<Boolean>(valid && standard));
}

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

  // jstx_to_ctx(jstx, ctx);
  CTransaction ctx;
  CDataStream ssData(ParseHex(tx_hex), SER_NETWORK, PROTOCOL_VERSION);
  ssData >> ctx;

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
  if (nValue + nTransactionFee > pwalletMain->GetBalance())
    return NanThrowError("Insufficient funds");

  int64_t nFeeRet = nTransactionFee;

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

  // Fill inputs if they aren't already filled
  ctx.vin.clear();
  BOOST_FOREACH(const PAIRTYPE(const CWalletTx*,unsigned int)& coin, setCoins) {
    ctx.vin.push_back(CTxIn(coin.first->GetHash(), coin.second));
  }

  // Sign everything
  int nIn = 0;
  BOOST_FOREACH(const PAIRTYPE(const CWalletTx*,unsigned int)& coin, setCoins) {
    if (!SignSignature(*pwalletMain, *coin.first, ctx, nIn++)) {
      return NanThrowError("Signing transaction failed");
    }
  }

  // Turn our CTransaction into a javascript Transaction
  Local<Object> new_jstx = NanNew<Object>();
  ctx_to_jstx(ctx, 0, new_jstx);

  NanReturnValue(new_jstx);
}

/**
 * Wallet
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

CBitcoinAddress GetAccountAddress(std::string strAccount, bool bForceNew=false) {
  CWalletDB walletdb(pwalletMain->strWalletFile);

  CAccount account;
  walletdb.ReadAccount(strAccount, account);

  bool bKeyUsed = false;

  // Check if the current key has been used
  if (account.vchPubKey.IsValid()) {
    CScript scriptPubKey;
    scriptPubKey.SetDestination(account.vchPubKey.GetID());
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
      //CTxDestination dest = CNoDestination();
      CBitcoinAddress addr;
      //addr.Set(dest);
      return addr;
    }
    pwalletMain->SetAddressBook(account.vchPubKey.GetID(), strAccount, "receive");
    walletdb.WriteAccount(strAccount, account);
  }

  return CBitcoinAddress(account.vchPubKey.GetID());
}

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

  std::string strError = pwalletMain->SendMoneyToDestination(address.Get(), nAmount, wtx);
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
      "not enough keys supplied (got %"PRIszu" keys, but need at least %d to redeem)",
      keys->Length(), nRequired);
    NanThrowError(s);
    NanReturnValue(Undefined());
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
        return NanThrowError((ks + std::string(" does not refer to a key")).c_str());
      }
      CPubKey vchPubKey;
      if (!pwalletMain->GetPubKey(keyID, vchPubKey)) {
        return NanThrowError((std::string("no full public key for address ") + ks).c_str());
      }
      if (!vchPubKey.IsFullyValid()) {
        return NanThrowError((std::string("Invalid public key: ") + ks).c_str());
      }
      pubkeys[i] = vchPubKey;
    } else
    // Case 2: hex public key
#endif
    if (IsHex(ks)) {
      CPubKey vchPubKey(ParseHex(ks));
      if (!vchPubKey.IsFullyValid()) {
        return NanThrowError((std::string("Invalid public key: ") + ks).c_str());
      }
      pubkeys[i] = vchPubKey;
    } else {
      return NanThrowError((std::string("Invalid public key: ") + ks).c_str());
    }
  }
  CScript inner;
  inner.SetMultisig(nRequired, pubkeys);

  // Construct using pay-to-script-hash:
  CScriptID innerID = inner.GetID();
  CBitcoinAddress address(innerID);

  Local<Object> result = NanNew<Object>();
  result->Set(NanNew<String>("address"), NanNew<String>(address.ToString()));
  result->Set(NanNew<String>("redeemScript"), NanNew<String>(HexStr(inner.begin(), inner.end())));

  NanReturnValue(result);
}

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
      wtx.GetAmounts(listReceived, listSent, allFee, strSentAccount);
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

  int64_t nBalance = GetAccountBalance(strAccount, nMinDepth);

  NanReturnValue(NanNew<Number>(nBalance));
}

NAN_METHOD(WalletGetUnconfirmedBalance) {
  NanScope();
  NanReturnValue(NanNew<Number>(pwalletMain->GetUnconfirmedBalance()));
}

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
  int64_t nBalance = GetAccountBalance(strAccount, nMinDepth);
  if (nAmount > nBalance) {
    data->err_msg = std::string("Account has insufficient funds");
    return;
  }

  // Send
  std::string strError = pwalletMain->SendMoneyToDestination(address.Get(), nAmount, wtx);
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

NAN_METHOD(WalletListTransactions) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletListTransactions(options)");
  }

  // Local<Object> options = Local<Object>::Cast(args[0]);

  NanReturnValue(Undefined());
}

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

  map<string, int64_t> mapAccountBalances;
  BOOST_FOREACH(const PAIRTYPE(CTxDestination, CAddressBookData)& entry, pwalletMain->mapAddressBook) {
    if (IsMine(*pwalletMain, entry.first)) { // This address belongs to me
      mapAccountBalances[entry.second.name] = 0;
    }
  }

  for (map<uint256, CWalletTx>::iterator it = pwalletMain->mapWallet.begin();
      it != pwalletMain->mapWallet.end(); ++it) {
    const CWalletTx& wtx = (*it).second;
    int64_t nFee;
    std::string strSentAccount;
    list<pair<CTxDestination, int64_t> > listReceived;
    list<pair<CTxDestination, int64_t> > listSent;
    int nDepth = wtx.GetDepthInMainChain();
    if (wtx.GetBlocksToMaturity() > 0 || nDepth < 0) {
      continue;
    }
    wtx.GetAmounts(listReceived, listSent, nFee, strSentAccount);
    mapAccountBalances[strSentAccount] -= nFee;
    BOOST_FOREACH(const PAIRTYPE(CTxDestination, int64_t)& s, listSent) {
      mapAccountBalances[strSentAccount] -= s.second;
    }
    if (nDepth >= nMinDepth) {
      BOOST_FOREACH(const PAIRTYPE(CTxDestination, int64_t)& r, listReceived) {
        if (pwalletMain->mapAddressBook.count(r.first)) {
          mapAccountBalances[pwalletMain->mapAddressBook[r.first].name] += r.second;
        } else {
          mapAccountBalances[""] += r.second;
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

NAN_METHOD(WalletGetTransaction) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletGetTransaction(options)");
  }

  // Local<Object> options = Local<Object>::Cast(args[0]);

  NanReturnValue(Undefined());
}

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

NAN_METHOD(WalletSetTxFee) {
  NanScope();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return NanThrowError(
      "Usage: bitcoindjs.walletSetTxFee(options)");
  }

  Local<Object> options = Local<Object>::Cast(args[0]);

  int64_t fee = options->Get(NanNew<String>("fee"))->IntegerValue();

  // Amount
  int64_t nAmount = 0;
  if (fee != 0.0) {
    nAmount = fee;
  }

  nTransactionFee = nAmount;

  NanReturnValue(True());
}

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
 */

static inline void
cblock_to_jsblock(const CBlock& cblock, const CBlockIndex* cblock_index, Local<Object> jsblock) {
  jsblock->Set(NanNew<String>("hash"), NanNew<String>(cblock.GetHash().GetHex().c_str()));
  CMerkleTx txGen(cblock.vtx[0]);
  txGen.SetMerkleBranch(&cblock);
  jsblock->Set(NanNew<String>("confirmations"), NanNew<Number>((int)txGen.GetDepthInMainChain()));
  jsblock->Set(NanNew<String>("size"), NanNew<Number>((int)::GetSerializeSize(cblock, SER_NETWORK, PROTOCOL_VERSION)));
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

    // const uint256 block_hash = cblock.GetHash();
    // ctx_to_jstx(ctx, block_hash, jstx);

    CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
    ssTx << ctx;
    std::string strHex = HexStr(ssTx.begin(), ssTx.end());
    jstx->Set(NanNew<String>("hex"), NanNew<String>(strHex));

    jstx->Set(NanNew<String>("txid"), NanNew<String>(ctx.GetHash().GetHex()));
    jstx->Set(NanNew<String>("version"), NanNew<Number>(ctx.nVersion));
    jstx->Set(NanNew<String>("locktime"), NanNew<Number>(ctx.nLockTime));

    Local<Array> vin = NanNew<Array>();
    int vi = 0;
    BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
      Local<Object> in = NanNew<Object>();
      if (ctx.IsCoinBase()) {
        in->Set(NanNew<String>("coinbase"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
      } else {
        in->Set(NanNew<String>("txid"), NanNew<String>(txin.prevout.hash.GetHex()));
        in->Set(NanNew<String>("vout"), NanNew<Number>((boost::int64_t)txin.prevout.n));
        Local<Object> o = NanNew<Object>();
        o->Set(NanNew<String>("asm"), NanNew<String>(txin.scriptSig.ToString()));
        o->Set(NanNew<String>("hex"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
        in->Set(NanNew<String>("scriptSig"), o);
      }
      in->Set(NanNew<String>("sequence"), NanNew<Number>((boost::int64_t)txin.nSequence));
      vin->Set(vi, in);
      vi++;
    }
    jstx->Set(NanNew<String>("vin"), vin);

    Local<Array> vout = NanNew<Array>();
    for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
      const CTxOut& txout = ctx.vout[vo];
      Local<Object> out = NanNew<Object>();
      out->Set(NanNew<String>("value"), NanNew<Number>(txout.nValue));
      out->Set(NanNew<String>("n"), NanNew<Number>((boost::int64_t)vo));

      Local<Object> o = NanNew<Object>();
      {
        const CScript& scriptPubKey = txout.scriptPubKey;
        Local<Object> out = o;
        bool fIncludeHex = true;

        txnouttype type;
        vector<CTxDestination> addresses;
        int nRequired;
        out->Set(NanNew<String>("asm"), NanNew<String>(scriptPubKey.ToString()));
        if (fIncludeHex) {
          out->Set(NanNew<String>("hex"), NanNew<String>(HexStr(scriptPubKey.begin(), scriptPubKey.end())));
        }
        if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
          out->Set(NanNew<String>("type"), NanNew<String>(GetTxnOutputType(type)));
        } else {
          out->Set(NanNew<String>("reqSigs"), NanNew<Number>(nRequired));
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

    {
      const uint256 block_hash = cblock.GetHash();
      if (block_hash != 0) {
        jstx->Set(NanNew<String>("blockhash"), NanNew<String>(block_hash.GetHex()));
        map<uint256, CBlockIndex*>::iterator mi = mapBlockIndex.find(block_hash);
        if (mi != mapBlockIndex.end() && (*mi).second) {
          CBlockIndex* cblock_index = (*mi).second;
          if (chainActive.Contains(cblock_index)) {
            jstx->Set(NanNew<String>("confirmations"),
              NanNew<Number>(1 + chainActive.Height() - cblock_index->nHeight));
            jstx->Set(NanNew<String>("time"), NanNew<Number>((boost::int64_t)cblock_index->nTime));
            jstx->Set(NanNew<String>("blocktime"), NanNew<Number>((boost::int64_t)cblock_index->nTime));
          } else {
            jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(0));
          }
        }
      }
    }

    txs->Set(ti, jstx);
    ti++;
  }
  jsblock->Set(NanNew<String>("tx"), txs);

  jsblock->Set(NanNew<String>("time"), NanNew<Number>((boost::int64_t)cblock.GetBlockTime()));
  jsblock->Set(NanNew<String>("nonce"), NanNew<Number>((boost::uint64_t)cblock.nNonce));
  jsblock->Set(NanNew<String>("bits"), NanNew<Number>(cblock.nBits));
  jsblock->Set(NanNew<String>("difficulty"), NanNew<Number>(GetDifficulty(cblock_index)));
  jsblock->Set(NanNew<String>("chainwork"), NanNew<String>(cblock_index->nChainWork.GetHex()));
  if (cblock_index->pprev) {
    jsblock->Set(NanNew<String>("previousblockhash"), NanNew<String>(cblock_index->pprev->GetBlockHash().GetHex()));
  }
  CBlockIndex *pnext = chainActive.Next(cblock_index);
  if (pnext) {
    jsblock->Set(NanNew<String>("nextblockhash"), NanNew<String>(pnext->GetBlockHash().GetHex()));
  }
}

static inline void
ctx_to_jstx(const CTransaction& ctx, uint256 block_hash, Local<Object> jstx) {
  CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
  ssTx << ctx;
  std::string strHex = HexStr(ssTx.begin(), ssTx.end());
  jstx->Set(NanNew<String>("hex"), NanNew<String>(strHex));

  jstx->Set(NanNew<String>("txid"), NanNew<String>(ctx.GetHash().GetHex()));
  jstx->Set(NanNew<String>("version"), NanNew<Number>(ctx.nVersion));
  jstx->Set(NanNew<String>("locktime"), NanNew<Number>(ctx.nLockTime));

  Local<Array> vin = NanNew<Array>();
  int vi = 0;
  BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
    Local<Object> in = NanNew<Object>();
    if (ctx.IsCoinBase()) {
      in->Set(NanNew<String>("coinbase"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    } else {
      in->Set(NanNew<String>("txid"), NanNew<String>(txin.prevout.hash.GetHex()));
      in->Set(NanNew<String>("vout"), NanNew<Number>((boost::int64_t)txin.prevout.n));
      Local<Object> o = NanNew<Object>();
      o->Set(NanNew<String>("asm"), NanNew<String>(txin.scriptSig.ToString()));
      o->Set(NanNew<String>("hex"), NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
      in->Set(NanNew<String>("scriptSig"), o);
    }
    in->Set(NanNew<String>("sequence"), NanNew<Number>((boost::int64_t)txin.nSequence));
    vin->Set(vi, in);
    vi++;
  }
  jstx->Set(NanNew<String>("vin"), vin);

  Local<Array> vout = NanNew<Array>();
  for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
    const CTxOut& txout = ctx.vout[vo];
    Local<Object> out = NanNew<Object>();
    out->Set(NanNew<String>("value"), NanNew<Number>(txout.nValue));
    out->Set(NanNew<String>("n"), NanNew<Number>((boost::int64_t)vo));

    Local<Object> o = NanNew<Object>();
    {
      const CScript& scriptPubKey = txout.scriptPubKey;
      Local<Object> out = o;
      bool fIncludeHex = true;

      txnouttype type;
      vector<CTxDestination> addresses;
      int nRequired;
      out->Set(NanNew<String>("asm"), NanNew<String>(scriptPubKey.ToString()));
      if (fIncludeHex) {
        out->Set(NanNew<String>("hex"), NanNew<String>(HexStr(scriptPubKey.begin(), scriptPubKey.end())));
      }
      if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
        out->Set(NanNew<String>("type"), NanNew<String>(GetTxnOutputType(type)));
      } else {
        out->Set(NanNew<String>("reqSigs"), NanNew<Number>(nRequired));
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
    map<uint256, CBlockIndex*>::iterator mi = mapBlockIndex.find(block_hash);
    if (mi != mapBlockIndex.end() && (*mi).second) {
      CBlockIndex* cblock_index = (*mi).second;
      if (chainActive.Contains(cblock_index)) {
        jstx->Set(NanNew<String>("confirmations"),
          NanNew<Number>(1 + chainActive.Height() - cblock_index->nHeight));
        jstx->Set(NanNew<String>("time"), NanNew<Number>((boost::int64_t)cblock_index->nTime));
        jstx->Set(NanNew<String>("blocktime"), NanNew<Number>((boost::int64_t)cblock_index->nTime));
      } else {
        jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(0));
      }
    }
  }
}

static inline void
jsblock_to_cblock(const Local<Object> jsblock, CBlock& cblock) {
  cblock.nVersion = (int)jsblock->Get(NanNew<String>("version"))->IntegerValue();

  String::AsciiValue mhash__(jsblock->Get(NanNew<String>("merkleroot"))->ToString());
  std::string mhash_ = *mhash__;
  if (mhash_[1] != 'x') mhash_ = "0x" + mhash_;
  uint256 mhash(mhash_);

  cblock.hashMerkleRoot = mhash;
  cblock.nTime = (unsigned int)jsblock->Get(NanNew<String>("time"))->IntegerValue();
  cblock.nNonce = (unsigned int)jsblock->Get(NanNew<String>("nonce"))->IntegerValue();
  cblock.nBits = (unsigned int)jsblock->Get(NanNew<String>("bits"))->IntegerValue();

  if (jsblock->Get(NanNew<String>("previousblockhash"))->IsString()) {
    String::AsciiValue hash__(jsblock->Get(NanNew<String>("previousblockhash"))->ToString());
    std::string hash_ = *hash__;
    if (hash_[1] != 'x') hash_ = "0x" + hash_;
    uint256 hash(hash_);
    cblock.hashPrevBlock = hash;
  } else {
    // genesis block
    uint256 hash(std::string("0x0000000000000000000000000000000000000000000000000000000000000000"));
    cblock.hashPrevBlock = hash;
  }

  Local<Array> txs = Local<Array>::Cast(jsblock->Get(NanNew<String>("tx")));
  for (unsigned int ti = 0; ti < txs->Length(); ti++) {
    Local<Object> jstx = Local<Object>::Cast(txs->Get(ti));
    CTransaction ctx;

    // jstx_to_ctx(jstx, ctx);

    ctx.nVersion = jstx->Get(NanNew<String>("version"))->IntegerValue();
    ctx.nLockTime = jstx->Get(NanNew<String>("locktime"))->IntegerValue();

    Local<Array> vin = Local<Array>::Cast(jstx->Get(NanNew<String>("vin")));
    for (unsigned int vi = 0; vi < vin->Length(); vi++) {
      CTxIn txin;
      Local<Object> in = Local<Object>::Cast(vin->Get(vi));

      std::string shash_;
      if (in->Get(NanNew<String>("coinbase"))->IsString()) {
        String::AsciiValue shash__(in->Get(NanNew<String>("coinbase"))->ToString());
        shash_ = *shash__;
      } else {
        String::AsciiValue shash__(in->Get(NanNew<String>("scriptSig"))->ToString());
        shash_ = *shash__;
      }
      if (shash_[1] != 'x') shash_ = "0x" + shash_;
      uint256 shash(shash_);
      CScript scriptSig(shash);

      txin.scriptSig = scriptSig;

      String::AsciiValue phash__(in->Get(NanNew<String>("txid"))->ToString());
      std::string phash_ = *phash__;
      if (phash_[1] != 'x') phash_ = "0x" + phash_;
      uint256 phash(phash_);

      txin.prevout.hash = phash;
      txin.prevout.n = (boost::int64_t)in->Get(NanNew<String>("vout"))->IntegerValue();
      txin.nSequence = (boost::int64_t)in->Get(NanNew<String>("sequence"))->IntegerValue();

      ctx.vin.push_back(txin);
    }

    Local<Array> vout = Local<Array>::Cast(jstx->Get(NanNew<String>("vout")));
    for (unsigned int vo = 0; vo < vout->Length(); vo++) {
      CTxOut txout;
      Local<Object> out = Local<Object>::Cast(vout->Get(vo));

      txout.nValue = (int64_t)out->Get(NanNew<String>("value"))->IntegerValue();

      Local<Object> spk = Local<Object>::Cast(out->Get(NanNew<String>("scriptPubKey")));
      String::AsciiValue phash__(spk->Get(NanNew<String>("hex")));
      std::string phash_ = *phash__;
      if (phash_[1] != 'x') phash_ = "0x" + phash_;
      uint256 phash(phash_);
      CScript scriptPubKey(phash);

      txout.scriptPubKey = scriptPubKey;

      ctx.vout.push_back(txout);
    }

    cblock.vtx.push_back(ctx);
  }
}

static inline void
jstx_to_ctx(const Local<Object> jstx, CTransaction& ctx) {
  ctx.nVersion = jstx->Get(NanNew<String>("version"))->IntegerValue();
  ctx.nLockTime = jstx->Get(NanNew<String>("locktime"))->IntegerValue();

  Local<Array> vin = Local<Array>::Cast(jstx->Get(NanNew<String>("vin")));
  for (unsigned int vi = 0; vi < vin->Length(); vi++) {
    CTxIn txin;
    Local<Object> in = Local<Object>::Cast(vin->Get(vi));

    std::string shash_;
    if (in->Get(NanNew<String>("coinbase"))->IsString()) {
      String::AsciiValue shash__(in->Get(NanNew<String>("coinbase"))->ToString());
      shash_ = *shash__;
    } else {
      String::AsciiValue shash__(in->Get(NanNew<String>("scriptSig"))->ToString());
      shash_ = *shash__;
    }
    if (shash_[1] != 'x') shash_ = "0x" + shash_;
    uint256 shash(shash_);
    CScript scriptSig(shash);

    txin.scriptSig = scriptSig;

    String::AsciiValue phash__(in->Get(NanNew<String>("txid"))->ToString());
    std::string phash_ = *phash__;
    if (phash_[1] != 'x') phash_ = "0x" + phash_;

    uint256 phash(phash_);

    txin.prevout.hash = phash;
    txin.prevout.n = (boost::int64_t)in->Get(NanNew<String>("vout"))->IntegerValue();
    txin.nSequence = (boost::int64_t)in->Get(NanNew<String>("sequence"))->IntegerValue();

    ctx.vin.push_back(txin);
  }

  Local<Array> vout = Local<Array>::Cast(jstx->Get(NanNew<String>("vout")));
  for (unsigned int vo = 0; vo < vout->Length(); vo++) {
    CTxOut txout;
    Local<Object> out = Local<Object>::Cast(vout->Get(vo));

    txout.nValue = (int64_t)out->Get(NanNew<String>("value"))->IntegerValue();

    Local<Object> spk = Local<Object>::Cast(out->Get(NanNew<String>("scriptPubKey")));
    String::AsciiValue phash__(spk->Get(NanNew<String>("hex")));
    std::string phash_ = *phash__;
    if (phash_[1] != 'x') phash_ = "0x" + phash_;
    uint256 phash(phash_);
    CScript scriptPubKey(phash);

    txout.scriptPubKey = scriptPubKey;

    ctx.vout.push_back(txout);
  }
}

/**
 * Init
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();

  bitcoindjs_obj = target;

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
