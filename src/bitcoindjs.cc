/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "nan.h"

// bitcoind headers:
#include "core.h"
#include "addrman.h"
#include "checkpoints.h"
#include "crypter.h"
#include "main.h"
// #include "random.h"
// #include "timedata.h"
#include "walletdb.h"
#include "alert.h"
#include "checkqueue.h"
#include "db.h"
#include "miner.h"
#include "rpcclient.h"
#include "tinyformat.h"
#include "wallet.h"
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

NAN_METHOD(StartBitcoind);

static void
async_work(uv_work_t *req);

static void
async_after(uv_work_t *req);

static int
start_node(void);

extern "C" void
init(Handle<Object>);

struct async_data {
  Persistent<Function> callback;
  bool err;
  std::string err_msg;
  char *result;
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

  async_data* data = new async_data();
  data->err = false;
  data->callback = Persistent<Function>::New(callback);

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_work, (uv_after_work_cb)async_after);

  assert(status == 0);

  NanReturnValue(Undefined());
}

static void
async_work(uv_work_t *req) {
  async_data* data = static_cast<async_data*>(req->data);
  //start_node();
  data->result = (char *)strdup("opened");
}

static void
async_after(uv_work_t *req) {
  NanScope();
  async_data* data = static_cast<async_data*>(req->data);

  if (data->err) {
    Local<Value> err = Exception::Error(String::New(data->err_msg.c_str()));
    const unsigned argc = 1;
    Local<Value> argv[1] = { err };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[2] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(data->result))
    };
    TryCatch try_catch;
    data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  data->callback.Dispose();

  if (data->result != NULL) {
    free(data->result);
  }

  delete data;
  delete req;
}

extern void (ThreadImport)(std::vector<boost::filesystem::path>);
extern void (DetectShutdownThread)(boost::thread_group*);
extern int nScriptCheckThreads;
// extern const int DEFAULT_SCRIPTCHECK_THREADS; // static!!
// #ifdef ENABLE_WALLET
// extern std::string strWalletFile;
// extern CWallet *pwalletMain;
// #endif

// Relevant:
// ~/bitcoin/src/init.cpp
// ~/bitcoin/src/bitcoind.cpp
// ~/bitcoin/src/main.h

// Similar to AppInit2 - minus logs and arg parsing:

static int
start_node(void) {
  boost::thread_group threadGroup;
  boost::thread *detectShutdownThread = NULL;
  detectShutdownThread = new boost::thread(
    boost::bind(&DetectShutdownThread, &threadGroup));

  // int nScriptCheckThreads = 0;
  for (int i = 0; i < nScriptCheckThreads - 1; i++) {
    threadGroup.create_thread(&ThreadScriptCheck);
  }

  std::vector<boost::filesystem::path> vImportFiles;
  threadGroup.create_thread(boost::bind(&ThreadImport, vImportFiles));

  StartNode(threadGroup);

#ifdef ENABLE_WALLET
  if (pwalletMain) {
    // Add wallet transactions that aren't already in a block to mapTransactions
    pwalletMain->ReacceptWalletTransactions();
    // Run a thread to flush wallet periodically
    threadGroup.create_thread(boost::bind(&ThreadFlushWalletDB, boost::ref(pwalletMain->strWalletFile)));
  }
#endif

  return 0;
}

/**
 * Init
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();
  NODE_SET_METHOD(target, "start", StartBitcoind);
}

NODE_MODULE(bitcoindjs, init)
