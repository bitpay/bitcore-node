/**
 * bitcoind.js - a binding for node.js which links to libbitcoind.so/dylib.
 * Copyright (c) 2015, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */


#include "bitcoindjs.h"


using namespace std;
using namespace boost;
using namespace node;
using namespace v8;

/**
 * Bitcoin Globals
 */

// These global functions and variables are
// required to be defined/exposed here.

extern void DetectShutdownThread(boost::thread_group*);
extern int nScriptCheckThreads;
extern std::map<std::string, std::string> mapArgs;
extern CFeeRate payTxFee;
extern const std::string strMessageMagic;
extern std::string EncodeDumpTime(int64_t nTime);
extern int64_t DecodeDumpTime(const std::string &str);
extern std::string EncodeDumpString(const std::string &str);
extern std::string DecodeDumpString(const std::string &str);
extern bool fTxIndex;
static termios orig_termios;


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
async_get_progress(uv_work_t *req);

static void
async_get_progress_after(uv_work_t *req);

static void
async_get_tx(uv_work_t *req);

static void
async_get_tx_after(uv_work_t *req);

static void
async_get_addrtx(uv_work_t *req);

static void
async_get_addrtx_after(uv_work_t *req);

static void
async_broadcast_tx(uv_work_t *req);

static void
async_broadcast_tx_after(uv_work_t *req);

static void
async_block_tx(uv_work_t *req);

static void
async_block_tx_after(uv_work_t *req);

static void
async_block_time(uv_work_t *req);

static void
async_block_time_after(uv_work_t *req);

static void
async_from_tx(uv_work_t *req);

static void
async_from_tx_after(uv_work_t *req);

static inline void
cblock_to_jsblock(const CBlock& cblock, CBlockIndex* cblock_index, Local<Object> jsblock, bool is_new);

static inline void
ctx_to_jstx(const CTransaction& ctx, uint256 blockhash, Local<Object> jstx);

static inline void
jsblock_to_cblock(const Local<Object> jsblock, CBlock& cblock);

static inline void
jstx_to_ctx(const Local<Object> jstx, CTransaction& ctx);

static void
hook_packets(void);

static void
unhook_packets(void);

static bool
process_packets(CNode* pfrom);

static bool
process_packet(CNode* pfrom, string strCommand, CDataStream& vRecv, int64_t nTimeReceived);

static int
get_tx(uint256 txid, uint256& blockhash, CTransaction& ctx);

extern "C" void
init(Handle<Object>);

/**
 * Private Global Variables
 * Used only by bitcoindjs functions.
 */

static volatile bool shutdown_complete = false;
static char *g_data_dir = NULL;
static bool g_rpc = false;
static bool g_testnet = false;
static bool g_txindex = false;

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
  bool testnet;
  bool txindex;
  Eternal<Function> callback;
};

/**
 * async_block_data
 */

struct async_block_data {
  std::string err_msg;
  std::string hash;
  int64_t height;
  CBlock cblock;
  CBlockIndex* cblock_index;
  Eternal<Function> callback;
};

/**
 * async_tx_data
 */

struct async_tx_data {
  std::string err_msg;
  std::string txid;
  std::string blockhash;
  CTransaction ctx;
  Eternal<Function> callback;
};

/**
 * async_block_tx_data
 */

struct async_block_tx_data {
  std::string err_msg;
  std::string txid;
  CBlock cblock;
  CBlockIndex* cblock_index;
  CTransaction ctx;
  Eternal<Function> callback;
};

/**
 * async_block_time_data
 */

typedef struct _cblocks_list {
  CBlock cblock;
  CBlockIndex* cblock_index;
  struct _cblocks_list *next;
  std::string err_msg;
} cblocks_list;

struct async_block_time_data {
  std::string err_msg;
  uint32_t gte;
  uint32_t lte;
  int64_t limit;
  cblocks_list *cblocks;
  Eternal<Function> callback;
};

/**
 * async_addrtx_data
 */

typedef struct _ctx_list {
  CTransaction ctx;
  uint256 blockhash;
  struct _ctx_list *next;
  std::string err_msg;
} ctx_list;

struct async_addrtx_data {
  std::string err_msg;
  std::string addr;
  ctx_list *ctxs;
  int64_t blockheight;
  int64_t blocktime;
  Eternal<Function> callback;
};

/**
 * async_broadcast_tx_data
 */

struct async_broadcast_tx_data {
  std::string err_msg;
  Eternal<Object> jstx;
  CTransaction ctx;
  std::string txid;
  bool override_fees;
  bool own_only;
  Eternal<Function> callback;
};

/**
 * async_from_tx_data
 */

struct async_from_tx_data {
  std::string err_msg;
  std::string txid;
  ctx_list *ctxs;
  Eternal<Function> callback;
};

/**
 * Read Raw DB
 */

#if USE_LDB_ADDR
static ctx_list *
read_addr(const std::string addr, const int64_t blockheight, const int64_t blocktime);
#endif

#if USE_LDB_TX
static bool
get_block_by_tx(const std::string itxid, CBlock& rcblock, CBlockIndex **rcblock_index, CTransaction& rctx);
#endif

/**
 * Helpers
 */

static bool
set_cooked(void);

/**
 * Functions
 */

/**
 * StartBitcoind()
 * bitcoind.start(callback)
 * Start the bitcoind node with AppInit2() on a separate thread.
 */

NAN_METHOD(StartBitcoind) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  Local<Function> callback;
  std::string datadir = std::string("");
  bool rpc = false;
  bool testnet = false;
  bool txindex = false;

  if (args.Length() >= 2 && args[0]->IsObject() && args[1]->IsFunction()) {
    Local<Object> options = Local<Object>::Cast(args[0]);
    if (options->Get(NanNew<String>("datadir"))->IsString()) {
      String::Utf8Value datadir_(options->Get(NanNew<String>("datadir"))->ToString());
      datadir = std::string(*datadir_);
    }
    if (options->Get(NanNew<String>("rpc"))->IsBoolean()) {
      rpc = options->Get(NanNew<String>("rpc"))->ToBoolean()->IsTrue();
    }
    if (options->Get(NanNew<String>("testnet"))->IsBoolean()) {
      testnet = options->Get(NanNew<String>("testnet"))->ToBoolean()->IsTrue();
    }
    if (options->Get(NanNew<String>("txindex"))->IsBoolean()) {
      txindex = options->Get(NanNew<String>("txindex"))->ToBoolean()->IsTrue();
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
  data->testnet = testnet;
  data->txindex = txindex;

  Eternal<Function> eternal(isolate, callback);

  data->callback = eternal;
  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_start_node,
    (uv_after_work_cb)async_start_node_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

/**
 * async_start_node()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node(uv_work_t *req) {
  async_node_data *data = static_cast<async_node_data*>(req->data);
  if (data->datadir != "") {
    g_data_dir = (char *)data->datadir.c_str();
  } else {
    g_data_dir = (char *)malloc(sizeof(char) * 512);
    snprintf(g_data_dir, sizeof(char) * 512, "%s/.bitcoind.js", getenv("HOME"));
  }
  g_rpc = (bool)data->rpc;
  g_testnet = (bool)data->testnet;
  g_txindex = (bool)data->txindex;
  tcgetattr(STDIN_FILENO, &orig_termios);
  start_node();
  data->result = std::string("bitcoind opened.");
}

/**
 * async_start_node_after()
 * Execute our callback.
 */

static void
async_start_node_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_node_data *data = static_cast<async_node_data*>(req->data);

  Local<Function> cb = data->callback.Get(isolate);
  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
     v8::Null(isolate),
     Local<Value>::New(isolate, NanNew<String>(data->result))
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * start_node(void)
 * Start AppInit2() on a separate thread, wait for
 * Unfortunately, we need to wait for the initialization
 * to unhook the signal handlers so we can use them
 * from node.js in javascript.
 */

static int
start_node(void) {
  SetupEnvironment();

  noui_connect();

  new boost::thread(boost::bind(&start_node_thread));

  // Drop the bitcoind signal handlers: we want our own.
  signal(SIGINT, SIG_DFL);
  signal(SIGHUP, SIG_DFL);
  signal(SIGQUIT, SIG_DFL);

  // Hook into packet handling
  new boost::thread(boost::bind(&hook_packets));

  return 0;
}

static void
start_node_thread(void) {
  boost::thread_group threadGroup;
  boost::thread* detectShutdownThread = NULL;

  // Workaround for AppInit2() arg parsing. Not ideal, but it works.
  int argc = 0;
  char **argv = (char **)malloc((4 + 1) * sizeof(char **));

  argv[argc] = (char *)"bitcoind";
  argc++;

  if (g_data_dir) {
    const int argl = 9 + strlen(g_data_dir) + 1;
    char *arg = (char *)malloc(sizeof(char) * argl);
    int w = snprintf(arg, argl, "-datadir=%s", g_data_dir);
    if (w >= 10 && w <= argl) {
      arg[w] = '\0';
      argv[argc] = arg;
      argc++;
    } else {
      if (set_cooked()) {
        fprintf(stderr, "bitcoind.js: Bad -datadir value.\n");
      }
    }
  }

  if (g_rpc) {
    argv[argc] = (char *)"-server";
    argc++;
  }

  if (g_testnet) {
    argv[argc] = (char *)"-testnet";
    argc++;
  }

  if (g_txindex) {
    argv[argc] = (char *)"-txindex";
    argc++;
  }

  argv[argc] = NULL;

  bool fRet = false;
  try {
    ParseParameters((const int)argc, (const char **)argv);

    if (!boost::filesystem::is_directory(GetDataDir(false))) {
      if (set_cooked()) {
        fprintf(stderr,
          "bitcoind.js: Specified data directory \"%s\" does not exist.\n",
          mapArgs["-datadir"].c_str());
      }
      shutdown_complete = true;
      _exit(1);
      return;
    }

    try {
      ReadConfigFile(mapArgs, mapMultiArgs);
    } catch(std::exception &e) {
      if (set_cooked()) {
        fprintf(stderr,
          "bitcoind.js: Error reading configuration file: %s\n", e.what());
      }
      shutdown_complete = true;
      _exit(1);
      return;
    }

    if (!SelectParamsFromCommandLine()) {
      if (set_cooked()) {
        fprintf(stderr,
          "bitcoind.js: Invalid combination of -regtest and -testnet.\n");
      }
      shutdown_complete = true;
      _exit(1);
      return;
    }

    CreatePidFile(GetPidFile(), getpid());

    detectShutdownThread = new boost::thread(
      boost::bind(&DetectShutdownThread, &threadGroup));
    fRet = AppInit2(threadGroup);
  } catch (std::exception& e) {
     if (set_cooked()) {
       fprintf(stderr, "bitcoind.js: AppInit(): std::exception\n");
     }
  } catch (...) {
    if (set_cooked()) {
      fprintf(stderr, "bitcoind.js: AppInit(): other exception\n");
    }
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

  // bitcoind is shutdown. Notify the main thread
  // which is polling this variable:
  shutdown_complete = true;
}

/**
 * StopBitcoind()
 * bitcoind.stop(callback)
 */

NAN_METHOD(StopBitcoind) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

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
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_stop_node,
    (uv_after_work_cb)async_stop_node_after);

  assert(status == 0);
  NanReturnValue(Undefined(isolate));

}

/**
 * async_stop_node()
 * Call StartShutdown() to join the boost threads, which will call Shutdown()
 * and set shutdown_complete to true to notify the main node.js thread.
 */

static void
async_stop_node(uv_work_t *req) {
  async_node_data *data = static_cast<async_node_data*>(req->data);
  unhook_packets();
  StartShutdown();
  data->result = std::string("bitcoind shutdown.");
}

/**
 * async_stop_node_after()
 * Execute our callback.
 */

static void
async_stop_node_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_node_data* data = static_cast<async_node_data*>(req->data);

  Local<Function> cb = data->callback.Get(isolate);
  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, NanNew<String>(data->result))
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

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
 * bitcoind.getBlock([blockhash,blockheight], callback)
 * Read any block from disk asynchronously.
 */

NAN_METHOD(GetBlock) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 2
      || (!args[0]->IsString() && !args[0]->IsNumber())
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getBlock([blockhash,blockheight], callback)");
  }

  async_block_data *data = new async_block_data();

  if (args[0]->IsNumber()) {
    int64_t height = args[0]->IntegerValue();
    data->err_msg = std::string("");
    data->hash = std::string("");
    data->height = height;
  } else {
    String::Utf8Value hash_(args[0]->ToString());
    std::string hash = std::string(*hash_);
    data->err_msg = std::string("");
    data->hash = hash;
    data->height = -1;
  }

  Local<Function> callback = Local<Function>::Cast(args[1]);
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_block,
    (uv_after_work_cb)async_get_block_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_get_block(uv_work_t *req) {
  async_block_data* data = static_cast<async_block_data*>(req->data);

  if (data->height != -1) {
    CBlockIndex* pblockindex = chainActive[data->height];
    CBlock cblock;
    if (ReadBlockFromDisk(cblock, pblockindex)) {
      data->cblock = cblock;
      data->cblock_index = pblockindex;
    } else {
      data->err_msg = std::string("Block not found.");
    }
    return;
  }

  std::string strHash = data->hash;
  uint256 hash(strHash);
  CBlock cblock;
  CBlockIndex* pblockindex = mapBlockIndex[hash];

  if (ReadBlockFromDisk(cblock, pblockindex)) {
    data->cblock = cblock;
    data->cblock_index = pblockindex;
  } else {
    data->err_msg = std::string("Block not found.");
  }
}

static void
async_get_block_after(uv_work_t *req) {
  Isolate *isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_block_data* data = static_cast<async_block_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const CBlock& cblock = data->cblock;
    CBlockIndex* cblock_index = data->cblock_index;

    Local<Object> jsblock = NanNew<Object>();
    cblock_to_jsblock(cblock, cblock_index, jsblock, false);

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, jsblock)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetTransaction()
 * bitcoind.getTransaction(txid, [blockhash], callback)
 * Read any transaction from disk asynchronously.
 */

NAN_METHOD(GetTransaction) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 3
      || !args[0]->IsString()
      || !args[1]->IsString()
      || !args[2]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getTransaction(txid, [blockhash], callback)");
  }

  String::Utf8Value txid_(args[0]->ToString());
  String::Utf8Value blockhash_(args[1]->ToString());
  Local<Function> callback = Local<Function>::Cast(args[2]);

  std::string txid = std::string(*txid_);
  std::string blockhash = std::string(*blockhash_);

  if (blockhash == "") {
    blockhash = uint256(0).GetHex();
  }

  async_tx_data *data = new async_tx_data();
  data->err_msg = std::string("");
  data->txid = txid;
  data->blockhash = blockhash;
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_tx,
    (uv_after_work_cb)async_get_tx_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_get_tx(uv_work_t *req) {
  async_tx_data* data = static_cast<async_tx_data*>(req->data);

  uint256 hash(data->txid);
  uint256 blockhash(data->blockhash);
  CTransaction ctx;

  if (get_tx(hash, blockhash, ctx)) {
    data->ctx = ctx;
    data->blockhash = blockhash.GetHex();
  } else {
    data->err_msg = std::string("Transaction not found.");
  }
}

static void
async_get_tx_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_tx_data* data = static_cast<async_tx_data*>(req->data);

  CTransaction ctx = data->ctx;
  uint256 blockhash(data->blockhash);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    Local<Object> jstx = NanNew<Object>();
    ctx_to_jstx(ctx, blockhash, jstx);

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, jstx)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }
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
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
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
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  Eternal<Object> eternalObject(isolate, jstx);
  data->jstx = eternalObject;

  CTransaction ctx;
  jstx_to_ctx(jstx, ctx);
  data->ctx = ctx;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_broadcast_tx,
    (uv_after_work_cb)async_broadcast_tx_after);

  assert(status == 0);
  NanReturnValue(Undefined(isolate));
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
  }

  RelayTransaction(ctx);

  data->txid = hashTx.GetHex();
}

static void
async_broadcast_tx_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_broadcast_tx_data* data = static_cast<async_broadcast_tx_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);
  Local<Object> obj = data->jstx.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 3;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, NanNew<String>(data->txid)),
      Local<Value>::New(isolate, obj)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

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
 * GetInfo()
 * bitcoindjs.getInfo()
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
  obj->Set(NanNew<String>("blocks"), NanNew<Number>((int)chainActive.Height())->ToInt32());
  obj->Set(NanNew<String>("timeoffset"), NanNew<Number>(GetTimeOffset()));
  obj->Set(NanNew<String>("connections"), NanNew<Number>((int)vNodes.size())->ToInt32());
  obj->Set(NanNew<String>("proxy"), NanNew<String>(proxy.IsValid() ? proxy.ToStringIPPort() : std::string("")));
  obj->Set(NanNew<String>("difficulty"), NanNew<Number>((double)GetDifficulty()));
  obj->Set(NanNew<String>("testnet"), NanNew<Boolean>(Params().NetworkIDString() == "test"));
  obj->Set(NanNew<String>("relayfee"), NanNew<Number>(::minRelayTxFee.GetFeePerK())); // double
  obj->Set(NanNew<String>("errors"), NanNew<String>(GetWarnings("statusbar")));

  NanReturnValue(obj);
}

/**
 * GetPeerInfo()
 * bitcoindjs.getPeerInfo()
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
      obj->Set(NanNew<String>("synced_headers"), NanNew<Number>(statestats.nSyncHeight)->ToInt32());
      obj->Set(NanNew<String>("synced_blocks"), NanNew<Number>(statestats.nCommonHeight)->ToInt32());
      Local<Array> heights = NanNew<Array>();
      int hi = 0;
      BOOST_FOREACH(int height, statestats.vHeightInFlight) {
        heights->Set(hi, NanNew<Number>(height));
        hi++;
      }
      obj->Set(NanNew<String>("inflight"), heights);
    }

    obj->Set(NanNew<String>("whitelisted"), NanNew<Boolean>(stats.fWhitelisted));
    // obj->Set(NanNew<String>("relaytxes"), NanNew<Boolean>(stats.fRelayTxes));

    array->Set(i, obj);
    i++;
  }

  NanReturnValue(array);
}

/**
 * GetAddresses()
 * bitcoindjs.getAddresses()
 * Get all addresses
 */

NAN_METHOD(GetAddresses) {
  NanScope();

  if (args.Length() > 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getAddresses()");
  }

  Local<Array> array = NanNew<Array>();
  int i = 0;

  std::vector<CAddress> vAddr = addrman.GetAddr();

  BOOST_FOREACH(const CAddress& addr, vAddr) {
    Local<Object> obj = NanNew<Object>();

    char nServices[21] = {0};
    int written = snprintf(nServices, sizeof(nServices), "%020llu", (uint64_t)addr.nServices);
    assert(written == 20);

    obj->Set(NanNew<String>("services"), NanNew<String>((char *)nServices));
    obj->Set(NanNew<String>("time"), NanNew<Number>((unsigned int)addr.nTime)->ToUint32());
    obj->Set(NanNew<String>("last"), NanNew<Number>((int64_t)addr.nLastTry));
    obj->Set(NanNew<String>("ip"), NanNew<String>((std::string)addr.ToStringIP()));
    obj->Set(NanNew<String>("port"), NanNew<Number>((unsigned short)addr.GetPort())->ToUint32());
    obj->Set(NanNew<String>("address"), NanNew<String>((std::string)addr.ToStringIPPort()));

    array->Set(i, obj);
    i++;
  }

  NanReturnValue(array);
}

/**
 * GetProgress()
 * bitcoindjs.getProgress(callback)
 * Get progress of blockchain download
 */

NAN_METHOD(GetProgress) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 1 || !args[0]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getProgress(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(args[0]);

  async_block_data *data = new async_block_data();
  data->err_msg = std::string("");
  CBlockIndex *pindex = chainActive.Tip();
  data->hash = pindex->GetBlockHash().GetHex();
  data->height = -1;

  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_progress,
    (uv_after_work_cb)async_get_progress_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_get_progress(uv_work_t *req) {
  async_get_block(req);
}

static void
async_get_progress_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_block_data* data = static_cast<async_block_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const CBlock& cblock = data->cblock;
    CBlockIndex* cblock_index = data->cblock_index;

    Local<Object> jsblock = NanNew<Object>();
    cblock_to_jsblock(cblock, cblock_index, jsblock, false);

    const CBlock& cgenesis = Params().GenesisBlock();

    Local<Object> genesis = NanNew<Object>();
    cblock_to_jsblock(cgenesis, NULL, genesis, false);

    // Get progress:
    double progress = Checkpoints::GuessVerificationProgress(cblock_index, false);

    // Get time left (assume last block was ten minutes ago):
    int64_t now = ((int64_t)time(NULL) - (10 * 60));
    int64_t left = now - (progress * now);

    // Calculate tangible progress:
    unsigned int hours_behind = left / 60 / 60;
    unsigned int days_behind = left / 60 / 60 / 24;
    unsigned int percent = (unsigned int)(progress * 100.0);

    if (percent == 100 || left < 0) {
      hours_behind = 0;
      days_behind = 0;
    }

    Local<Object> result = NanNew<Object>();

    result->Set(NanNew<String>("blocks"),
      NanNew<Number>(cblock_index->nHeight));
    result->Set(NanNew<String>("connections"),
      NanNew<Number>((int)vNodes.size())->ToInt32());
    result->Set(NanNew<String>("genesisBlock"), genesis);
    result->Set(NanNew<String>("currentBlock"), jsblock);
    result->Set(NanNew<String>("hoursBehind"), NanNew<Number>(hours_behind));
    result->Set(NanNew<String>("daysBehind"), NanNew<Number>(days_behind));
    result->Set(NanNew<String>("percent"), NanNew<Number>(percent));

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate,result)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetMiningInfo()
 * bitcoindjs.getMiningInfo()
 * Get coin generation / mining information
 */

NAN_METHOD(GetMiningInfo) {
  NanScope();

  Local<Object> obj = NanNew<Object>();

  json_spirit::Array empty_params;

  obj->Set(NanNew<String>("blocks"), NanNew<Number>((int)chainActive.Height()));
  obj->Set(NanNew<String>("currentblocksize"), NanNew<Number>((uint64_t)nLastBlockSize));
  obj->Set(NanNew<String>("currentblocktx"), NanNew<Number>((uint64_t)nLastBlockTx));
  obj->Set(NanNew<String>("difficulty"), NanNew<Number>((double)GetDifficulty()));
  obj->Set(NanNew<String>("errors"), NanNew<String>(GetWarnings("statusbar")));
  obj->Set(NanNew<String>("genproclimit"), NanNew<Number>((int)GetArg("-genproclimit", -1)));
  obj->Set(NanNew<String>("networkhashps"), NanNew<Number>(
    (int64_t)getnetworkhashps(empty_params, false).get_int64()));
  obj->Set(NanNew<String>("pooledtx"), NanNew<Number>((uint64_t)mempool.size()));
  obj->Set(NanNew<String>("testnet"), NanNew<Boolean>(Params().NetworkIDString() == "test"));
  obj->Set(NanNew<String>("chain"), NanNew<String>(Params().NetworkIDString()));

  NanReturnValue(obj);
}

/**
 * GetAddrTransactions()
 * bitcoind.getAddrTransactions(addr, callback)
 * Read any transaction from disk asynchronously.
 */

NAN_METHOD(GetAddrTransactions) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 2
      || (!args[0]->IsString() && !args[0]->IsObject())
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getAddrTransactions(addr, callback)");
  }

  std::string addr = "";
  int64_t blockheight = -1;
  int64_t blocktime = -1;

  if (args[0]->IsString()) {
    String::Utf8Value addr_(args[0]->ToString());
    addr = std::string(*addr_);
  } else if (args[0]->IsObject()) {
    Local<Object> options = Local<Object>::Cast(args[0]);
    if (options->Get(NanNew<String>("address"))->IsString()) {
      String::Utf8Value s_(options->Get(NanNew<String>("address"))->ToString());
      addr = std::string(*s_);
    }
    if (options->Get(NanNew<String>("addr"))->IsString()) {
      String::Utf8Value s_(options->Get(NanNew<String>("addr"))->ToString());
      addr = std::string(*s_);
    }
    if (options->Get(NanNew<String>("height"))->IsNumber()) {
      blockheight = options->Get(NanNew<String>("height"))->IntegerValue();
    }
    if (options->Get(NanNew<String>("blockheight"))->IsNumber()) {
      blockheight = options->Get(NanNew<String>("blockheight"))->IntegerValue();
    }
    if (options->Get(NanNew<String>("time"))->IsNumber()) {
      blocktime = options->Get(NanNew<String>("time"))->IntegerValue();
    }
    if (options->Get(NanNew<String>("blocktime"))->IsNumber()) {
      blocktime = options->Get(NanNew<String>("blocktime"))->IntegerValue();
    }
  }

  Local<Function> callback = Local<Function>::Cast(args[1]);

  async_addrtx_data *data = new async_addrtx_data();
  data->err_msg = std::string("");
  data->addr = addr;
  data->ctxs = NULL;
  data->blockheight = blockheight;
  data->blocktime = blocktime;
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  int status = uv_queue_work(uv_default_loop(),
    req, async_get_addrtx,
    (uv_after_work_cb)async_get_addrtx_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_get_addrtx(uv_work_t *req) {
  async_addrtx_data* data = static_cast<async_addrtx_data*>(req->data);

  if (data->addr.empty()) {
    data->err_msg = std::string("Invalid address.");
    return;
  }

  CBitcoinAddress address = CBitcoinAddress(data->addr);
  if (!address.IsValid()) {
    data->err_msg = std::string("Invalid address.");
    return;
  }

#if !USE_LDB_ADDR
  CScript expected = GetScriptForDestination(address.Get());

  int64_t i = 0;

  if (data->blockheight != -1) {
    i = data->blockheight;
  }

  int64_t height = chainActive.Height();

  for (; i <= height; i++) {
    CBlockIndex* pblockindex = chainActive[i];
    CBlock cblock;
    if (ReadBlockFromDisk(cblock, pblockindex)) {
      BOOST_FOREACH(const CTransaction& ctx, cblock.vtx) {
        // vin
        BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
          if (txin.scriptSig.ToString() == expected.ToString()) {
            ctx_list *item = new ctx_list();
            item->ctx = ctx;
            item->blockhash = cblock.GetHash();
            if (data->ctxs == NULL) {
              data->ctxs = item;
            } else {
              data->ctxs->next = item;
              data->ctxs = item;
            }
            goto done;
          }
        }

        // vout
        for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
          const CTxOut& txout = ctx.vout[vo];
          const CScript& scriptPubKey = txout.scriptPubKey;
          txnouttype type;
          vector<CTxDestination> addresses;
          int nRequired;
          if (ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
            BOOST_FOREACH(const CTxDestination& addr, addresses) {
              std::string str_addr = CBitcoinAddress(addr).ToString();
              if (data->addr == str_addr) {
                ctx_list *item = new ctx_list();
                item->ctx = ctx;
                item->blockhash = cblock.GetHash();
                if (data->ctxs == NULL) {
                  data->ctxs = item;
                } else {
                  data->ctxs->next = item;
                  data->ctxs = item;
                }
                goto done;
              }
            }
          }
        }
      }

done:
      continue;
    } else {
      data->err_msg = std::string("Address not found.");
      break;
    }
  }
  return;
#else
  ctx_list *ctxs = read_addr(data->addr, data->blockheight, data->blocktime);
  if (!ctxs->err_msg.empty()) {
    data->err_msg = ctxs->err_msg;
    return;
  }
  data->ctxs = ctxs;
  if (data->ctxs == NULL) {
    data->err_msg = std::string("Could not read database.");
  }
#endif
}

static void
async_get_addrtx_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  async_addrtx_data* data = static_cast<async_addrtx_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Object> result = NanNew<Object>();
    Local<Array> tx = NanNew<Array>();
    int i = 0;
    ctx_list *next;
    for (ctx_list *item = data->ctxs; item; item = next) {
      Local<Object> jstx = NanNew<Object>();
      ctx_to_jstx(item->ctx, item->blockhash, jstx);
      tx->Set(i, jstx);
      i++;
      next = item->next;
      delete item;
    }
    result->Set(NanNew<String>("address"), NanNew<String>(data->addr));
    result->Set(NanNew<String>("tx"), tx);
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, result)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetBestBlock()
 * bitcoindjs.getBestBlock()
 * Get the best block
 */

NAN_METHOD(GetBestBlock) {
  NanScope();

  if (args.Length() < 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getBestBlock()");
  }

  uint256 hash = pcoinsTip->GetBestBlock();

  NanReturnValue(NanNew<String>(hash.GetHex()));
}

/**
 * GetChainHeight()
 * bitcoindjs.getChainHeight()
 * Get miscellaneous information
 */

NAN_METHOD(GetChainHeight) {
  NanScope();

  if (args.Length() > 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getChainHeight()");
  }

  NanReturnValue(NanNew<Number>((int)chainActive.Height())->ToInt32());
}

/**
 * GetBlockByTx()
 * bitcoindjs.getBlockByTx()
 * Get block by tx hash (requires -txindex or it's very slow)
 */

NAN_METHOD(GetBlockByTx) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getBlockByTx(txid, callback)");
  }

  async_block_tx_data *data = new async_block_tx_data();

  uv_work_t *req = new uv_work_t();
  req->data = data;

  String::Utf8Value txid_(args[0]->ToString());
  std::string txid = std::string(*txid_);
  data->err_msg = std::string("");
  data->txid = txid;

  Local<Function> callback = Local<Function>::Cast(args[1]);
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  int status = uv_queue_work(uv_default_loop(),
    req, async_block_tx,
    (uv_after_work_cb)async_block_tx_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_block_tx(uv_work_t *req) {
  async_block_tx_data* data = static_cast<async_block_tx_data*>(req->data);
#if USE_LDB_TX
  if (!g_txindex) {
parse:
#endif
    int64_t i = 0;
    int64_t height = chainActive.Height();
    for (; i <= height; i++) {
      CBlockIndex* pblockindex = chainActive[i];
      CBlock cblock;
      if (ReadBlockFromDisk(cblock, pblockindex)) {
        BOOST_FOREACH(const CTransaction& tx, cblock.vtx) {
          if (tx.GetHash().GetHex() == data->txid) {
            data->cblock = cblock;
            data->cblock_index = pblockindex;
            data->ctx = tx;
            return;
          }
        }
      }
    }
    data->err_msg = std::string("Block not found.");
    return;
#if USE_LDB_TX
  }
  if (!get_block_by_tx(data->txid, data->cblock, &data->cblock_index, data->ctx)) {
    goto parse;
  }
#endif
}

static void
async_block_tx_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  async_block_tx_data* data = static_cast<async_block_tx_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const CBlock& cblock = data->cblock;
    CBlockIndex* cblock_index = data->cblock_index;
    const CTransaction& ctx = data->ctx;

    Local<Object> jsblock = NanNew<Object>();
    cblock_to_jsblock(cblock, cblock_index, jsblock, false);

    Local<Object> jstx = NanNew<Object>();
    ctx_to_jstx(ctx, cblock.GetHash(), jstx);

    const unsigned argc = 3;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, jsblock),
      Local<Value>::New(isolate, jstx)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetBlocksByTime()
 * bitcoindjs.getBlocksByTime()
 * Get block by tx hash (requires -txindex or it's very slow)
 */

NAN_METHOD(GetBlocksByTime) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getBlocksByTime(options, callback)");
  }

  async_block_time_data *data = new async_block_time_data();

  data->gte = 0;
  data->lte = 0;

  uv_work_t *req = new uv_work_t();
  req->data = data;

  Local<Object> options = Local<Object>::Cast(args[0]);
  if (options->Get(NanNew<String>("gte"))->IsNumber()) {
    data->gte = options->Get(NanNew<String>("gte"))->IntegerValue();
  }
  if (options->Get(NanNew<String>("lte"))->IsNumber()) {
    data->lte = options->Get(NanNew<String>("lte"))->IntegerValue();
  }
  if (options->Get(NanNew<String>("limit"))->IsNumber()) {
    data->limit = options->Get(NanNew<String>("limit"))->IntegerValue();
  }
  data->err_msg = std::string("");
  data->cblocks = NULL;

  Local<Function> callback = Local<Function>::Cast(args[1]);
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  int status = uv_queue_work(uv_default_loop(),
    req, async_block_time,
    (uv_after_work_cb)async_block_time_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_block_time(uv_work_t *req) {
  async_block_time_data* data = static_cast<async_block_time_data*>(req->data);
  if (!data->gte && !data->lte) {
    data->err_msg = std::string("gte and lte not found.");
    return;
  }
  int64_t i = 0;
  // XXX Slow: figure out how to ballpark the height based on gte and lte.
  int64_t height = chainActive.Height();
  bool found_range = false;
  int64_t found = 0;
  for (; i <= height; i++) {
    CBlockIndex* pblockindex = chainActive[i];
    CBlock cblock;
    if (ReadBlockFromDisk(cblock, pblockindex)) {
      uint32_t blocktime = cblock.GetBlockTime();
      if (blocktime >= data->gte && blocktime <= data->lte) {
        found_range = true;
        cblocks_list *item = new cblocks_list();
        item->cblock = cblock;
        item->cblock_index = pblockindex;
        if (data->cblocks == NULL) {
          data->cblocks = item;
        } else {
          data->cblocks->next = item;
          data->cblocks = item;
        }
        found++;
        if (found >= data->limit) return;
      } else {
        if (found_range) return;
      }
    }
  }
  data->err_msg = std::string("Block not found.");
}

static void
async_block_time_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  async_block_time_data* data = static_cast<async_block_time_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    Local<Array> jsblocks = NanNew<Array>();
    int i = 0;
    cblocks_list *next;
    for (cblocks_list *item = data->cblocks; item; item = next) {
      Local<Object> jsblock = NanNew<Object>();
      cblock_to_jsblock(item->cblock, item->cblock_index, jsblock, false);
      jsblocks->Set(i, jsblock);
      i++;
      next = item->next;
      delete item;
    }
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, jsblocks)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetFromTx()
 * bitcoindjs.getFromTx()
 * Get all TXes beyond a txid
 */

NAN_METHOD(GetFromTx) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
      "Usage: bitcoindjs.getFromTx(txid, callback)");
  }

  async_from_tx_data *data = new async_from_tx_data();

  uv_work_t *req = new uv_work_t();
  req->data = data;

  String::Utf8Value txid_(args[0]->ToString());
  std::string txid = std::string(*txid_);

  data->txid = txid;
  data->ctxs = NULL;
  data->err_msg = std::string("");

  Local<Function> callback = Local<Function>::Cast(args[1]);
  Eternal<Function> eternal(isolate, callback);
  data->callback = eternal;

  int status = uv_queue_work(uv_default_loop(),
    req, async_from_tx,
    (uv_after_work_cb)async_from_tx_after);

  assert(status == 0);

  NanReturnValue(Undefined(isolate));
}

static void
async_from_tx(uv_work_t *req) {
  async_from_tx_data* data = static_cast<async_from_tx_data*>(req->data);

  uint256 txid(data->txid);
  bool found = false;
  int64_t i = 0;
  int64_t height = chainActive.Height();

  for (; i <= height; i++) {
    CBlockIndex* pblockindex = chainActive[i];
    CBlock cblock;
    if (ReadBlockFromDisk(cblock, pblockindex)) {
      BOOST_FOREACH(const CTransaction& ctx, cblock.vtx) {
        if (found || ctx.GetHash() == txid) {
          if (!found) found = true;
          ctx_list *item = new ctx_list();
          item->ctx = ctx;
          item->blockhash = cblock.GetHash();
          if (data->ctxs == NULL) {
            data->ctxs = item;
          } else {
            data->ctxs->next = item;
            data->ctxs = item;
          }
        }
      }
    } else {
      data->err_msg = std::string("TX not found.");
      break;
    }
  }
}

static void
async_from_tx_after(uv_work_t *req) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  async_from_tx_data* data = static_cast<async_from_tx_data*>(req->data);
  Local<Function> cb = data->callback.Get(isolate);

  if (data->err_msg != "") {
    Local<Value> err = Exception::Error(NanNew<String>(data->err_msg));
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Array> tx = NanNew<Array>();
    int i = 0;
    ctx_list *next;
    for (ctx_list *item = data->ctxs; item; item = next) {
      Local<Object> jstx = NanNew<Object>();
      ctx_to_jstx(item->ctx, item->blockhash, jstx);
      tx->Set(i, jstx);
      i++;
      next = item->next;
      delete item;
    }
    Local<Value> argv[argc] = {
      Local<Value>::New(isolate, NanNull()),
      Local<Value>::New(isolate, tx)
    };
    TryCatch try_catch;
    cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  delete data;
  delete req;
}

/**
 * GetLastFileIndex()
 * bitcoindjs.getLastFileIndex()
 * Get last file index
 */

NAN_METHOD(GetLastFileIndex) {
  NanScope();

  if (args.Length() > 0) {
    return NanThrowError(
      "Usage: bitcoindjs.getLastFileIndex(callback)");
  }

  CBlockIndex *pindex = chainActive.Tip();
  CDiskBlockPos blockPos = pindex->GetBlockPos();

  NanReturnValue(NanNew<Number>(blockPos.nFile));
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

  data->Set(NanNew<String>("hash"), NanNew<String>(cblock.GetHash().GetHex()));

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

  data->Set(NanNew<String>("hash"), NanNew<String>(ctx.GetHash().GetHex()));

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
  String::Utf8Value hex_string_(args[0]->ToString());
  std::string hex_string = *hex_string_;

  CBlock cblock;
  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> cblock;
  } catch (std::exception &e) {
    return NanThrowError("Bad Block decode");
  }

  Local<Object> jsblock = NanNew<Object>();
  cblock_to_jsblock(cblock, NULL, jsblock, false);

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

  String::Utf8Value hex_string_(args[0]->ToString());
  std::string hex_string = *hex_string_;

  CTransaction ctx;
  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> ctx;
  } catch (std::exception &e) {
    return NanThrowError("Bad Block decode");
  }

  Local<Object> jstx = NanNew<Object>();
  ctx_to_jstx(ctx, 0, jstx);

  NanReturnValue(jstx);
}

/**
 * Linked List for queued packets
 */

typedef struct _poll_packets_list {
  CNode *pfrom;
  char *strCommand;
  CDataStream *vRecv;
  int64_t nTimeReceived;
  struct _poll_packets_list *next;
} poll_packets_list;

poll_packets_list *packets_queue_head = NULL;
poll_packets_list *packets_queue_tail = NULL;
boost::mutex poll_packets_mutex;

/**
 * HookPackets()
 * bitcoind.hookPackets(callback)
 */

NAN_METHOD(HookPackets) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  Local<Array> obj = NanNew<Array>();
  poll_packets_list *cur = NULL;
  poll_packets_list *next = NULL;
  int i = 0;

  poll_packets_mutex.lock();

  for (cur = packets_queue_head; cur; cur = next) {
    CNode *pfrom = cur->pfrom;
    std::string strCommand(cur->strCommand);
    CDataStream vRecv = *cur->vRecv;
    int64_t nTimeReceived = cur->nTimeReceived;

    Local<Object> o = NanNew<Object>();

    o->Set(NanNew<String>("name"), NanNew<String>(strCommand));
    o->Set(NanNew<String>("received"), NanNew<Number>((int64_t)nTimeReceived));
    o->Set(NanNew<String>("peerId"), NanNew<Number>(pfrom->id));
    o->Set(NanNew<String>("userAgent"),
      NanNew<String>(pfrom->cleanSubVer));

    if (strCommand == "version") {
      // Each connection can only send one version message
      if (pfrom->nVersion != 0) {
        NanReturnValue(Undefined(isolate));
      }

      bool fRelayTxes = false;
      int nStartingHeight = 0;
      int cleanSubVer = 0;
      //std::string strSubVer(strdup(pfrom->strSubVer.c_str()));
      std::string strSubVer = pfrom->strSubVer;
      int nVersion = pfrom->nVersion;
      uint64_t nServices = pfrom->nServices;

      int64_t nTime;
      CAddress addrMe;
      CAddress addrFrom;
      uint64_t nNonce = 1;
      vRecv >> nVersion >> nServices >> nTime >> addrMe;
      if (pfrom->nVersion < MIN_PEER_PROTO_VERSION) {
        // disconnect from peers older than this proto version
        NanReturnValue(Undefined(isolate));
      }

      if (nVersion == 10300) {
        nVersion = 300;
      }
      if (!vRecv.empty()) {
        vRecv >> addrFrom >> nNonce;
      }
      if (!vRecv.empty()) {
        vRecv >> LIMITED_STRING(strSubVer, 256);
        //cleanSubVer = SanitizeString(strSubVer);
        cleanSubVer = atoi(strSubVer.c_str());
      }
      if (!vRecv.empty()) {
        vRecv >> nStartingHeight;
      }
      if (!vRecv.empty()) {
        fRelayTxes = false;
      } else {
        fRelayTxes = true;
      }

      // Disconnect if we connected to ourself
      if (nNonce == nLocalHostNonce && nNonce > 1) {
        NanReturnValue(obj);
      }

      o->Set(NanNew<String>("receiveVersion"), NanNew<Number>(cleanSubVer));
      o->Set(NanNew<String>("version"), NanNew<Number>(nVersion));
      o->Set(NanNew<String>("height"), NanNew<Number>(nStartingHeight));
      o->Set(NanNew<String>("us"), NanNew<String>(addrMe.ToString()));
      o->Set(NanNew<String>("address"), NanNew<String>(pfrom->addr.ToString()));
      o->Set(NanNew<String>("relay"), NanNew<Boolean>(fRelayTxes));
    } else if (pfrom->nVersion == 0) {
      // Must have a version message before anything else
      NanReturnValue(Undefined(isolate));
    } else if (strCommand == "verack") {
      o->Set(NanNew<String>("receiveVersion"), NanNew<Number>(min(pfrom->nVersion, PROTOCOL_VERSION)));
    } else if (strCommand == "addr") {
      vector<CAddress> vAddr;
      vRecv >> vAddr;

      // Don't want addr from older versions unless seeding
      if (pfrom->nVersion < CADDR_TIME_VERSION && addrman.size() > 1000) {
        NanReturnValue(obj);
      }

      // Bad address size
      if (vAddr.size() > 1000) {
        NanReturnValue(Undefined(isolate));
      }

      Local<Array> array = NanNew<Array>();
      int i = 0;

      // Get the new addresses
      int64_t nNow = GetAdjustedTime();
      BOOST_FOREACH(CAddress& addr, vAddr) {
        boost::this_thread::interruption_point();

        unsigned int nTime = addr.nTime;
        if (nTime <= 100000000 || nTime > nNow + 10 * 60) {
          nTime = nNow - 5 * 24 * 60 * 60;
        }

        bool fReachable = IsReachable(addr);

        Local<Object> obj = NanNew<Object>();

        char nServices[21] = {0};
        int written = snprintf(nServices, sizeof(nServices), "%020llu", (uint64_t)addr.nServices);
        assert(written == 20);

        obj->Set(NanNew<String>("services"), NanNew<String>((char *)nServices));
        obj->Set(NanNew<String>("time"), NanNew<Number>((unsigned int)nTime)->ToUint32());
        obj->Set(NanNew<String>("last"), NanNew<Number>((int64_t)addr.nLastTry));
        obj->Set(NanNew<String>("ip"), NanNew<String>((std::string)addr.ToStringIP()));
        obj->Set(NanNew<String>("port"), NanNew<Number>((unsigned short)addr.GetPort())->ToUint32());
        obj->Set(NanNew<String>("address"), NanNew<String>((std::string)addr.ToStringIPPort()));
        obj->Set(NanNew<String>("reachable"), NanNew<Boolean>((bool)fReachable));

        array->Set(i, obj);
        i++;
      }

      o->Set(NanNew<String>("addresses"), array);
    } else if (strCommand == "inv") {
      vector<CInv> vInv;
      vRecv >> vInv;

      // Bad size
      if (vInv.size() > MAX_INV_SZ) {
        NanReturnValue(Undefined(isolate));
      }

      LOCK(cs_main);

      Local<Array> array = NanNew<Array>();
      int i = 0;

      for (unsigned int nInv = 0; nInv < vInv.size(); nInv++) {
        const CInv &inv = vInv[nInv];

        boost::this_thread::interruption_point();

        // Bad size
        if (pfrom->nSendSize > (SendBufferSize() * 2)) {
          NanReturnValue(Undefined(isolate));
        }

        Local<Object> item = NanNew<Object>();
        item->Set(NanNew<String>("hash"), NanNew<String>(inv.hash.GetHex()));
        item->Set(NanNew<String>("type"), NanNew<String>(
          inv.type == MSG_BLOCK || inv.type == MSG_FILTERED_BLOCK
          ? "block" : "tx"));
        if (inv.type == MSG_FILTERED_BLOCK) {
          item->Set(NanNew<String>("filtered"), NanNew<Boolean>(true));
        } else if (inv.type == MSG_BLOCK) {
          item->Set(NanNew<String>("filtered"), NanNew<Boolean>(false));
        }

        array->Set(i, item);
        i++;
      }

      o->Set(NanNew<String>("items"), array);
    } else if (strCommand == "getdata") {
      vector<CInv> vInv;
      vRecv >> vInv;

      // Bad size
      if (vInv.size() > MAX_INV_SZ) {
        NanReturnValue(Undefined(isolate));
      }

      o->Set(NanNew<String>("size"), NanNew<Number>(vInv.size()));
      if (vInv.size() > 0) {
        o->Set(NanNew<String>("first"), NanNew<String>(vInv[0].ToString()));
      }
    } else if (strCommand == "getblocks") {
      CBlockLocator locator;
      uint256 hashStop;
      vRecv >> locator >> hashStop;

      LOCK(cs_main);

      // Find the last block the caller has in the main chain
      CBlockIndex* pindex = FindForkInGlobalIndex(chainActive, locator);

      // Send the rest of the chain
      if (pindex) {
        pindex = chainActive.Next(pindex);
      }

      o->Set(NanNew<String>("fromHeight"), NanNew<Number>(pindex ? pindex->nHeight : -1));
      o->Set(NanNew<String>("toHash"), NanNew<String>(
        hashStop == uint256(0) ? "end" : hashStop.GetHex()));
      o->Set(NanNew<String>("limit"), NanNew<Number>(500));
    } else if (strCommand == "getheaders") {
      CBlockLocator locator;
      uint256 hashStop;
      vRecv >> locator >> hashStop;

      LOCK(cs_main);

      CBlockIndex* pindex = NULL;
      if (locator.IsNull()) {
        // If locator is null, return the hashStop block
        BlockMap::iterator mi = mapBlockIndex.find(hashStop);
        if (mi == mapBlockIndex.end()) {
          NanReturnValue(obj);
        }
        pindex = (*mi).second;
      } else {
        // Find the last block the caller has in the main chain
        pindex = FindForkInGlobalIndex(chainActive, locator);
        if (pindex) {
          pindex = chainActive.Next(pindex);
        }
      }

      o->Set(NanNew<String>("fromHeight"), NanNew<Number>(pindex ? pindex->nHeight : -1));
      o->Set(NanNew<String>("toHash"), NanNew<String>(hashStop.GetHex()));
    } else if (strCommand == "tx") {
      // XXX May be able to do prev_list asynchronously
      // XXX Potentially check for "reject" in original code
      CTransaction tx;
      vRecv >> tx;
      Local<Object> jstx = NanNew<Object>();
      ctx_to_jstx(tx, 0, jstx);
      o->Set(NanNew<String>("tx"), jstx);
      CNodeStats stats;
      pfrom->copyStats(stats);
      jstx->Set(NanNew<String>("from"), NanNew<String>(stats.addrName));
      if (!stats.addrLocal.empty()) {
        jstx->Set(NanNew<String>("fromlocal"), NanNew<String>(stats.addrLocal));
      }
    } else if (strCommand == "block" && !fImporting && !fReindex) {
      // XXX May be able to do prev_list asynchronously
      CBlock block;
      vRecv >> block;
      Local<Object> jsblock = NanNew<Object>();
      cblock_to_jsblock(block, NULL, jsblock, true);
      o->Set(NanNew<String>("block"), jsblock);
      CNodeStats stats;
      pfrom->copyStats(stats);
      jsblock->Set(NanNew<String>("from"), NanNew<String>(stats.addrName));
      if (!stats.addrLocal.empty()) {
        jsblock->Set(NanNew<String>("fromlocal"), NanNew<String>(stats.addrLocal));
      }
    } else if (strCommand == "getaddr") {
      ; // not much other information in getaddr as long as we know we got a getaddr
    } else if (strCommand == "mempool") {
      ; // not much other information in getaddr as long as we know we got a getaddr
    } else if (strCommand == "ping") {
      if (pfrom->nVersion > BIP0031_VERSION) {
        uint64_t nonce = 0;
        vRecv >> nonce;
        char sNonce[21] = {0};
        int written = snprintf(sNonce, sizeof(sNonce), "%020llu", (uint64_t)nonce);
        assert(written == 20);
        o->Set(NanNew<String>("nonce"), NanNew<String>(sNonce));
      } else {
        char sNonce[21] = {0};
        int written = snprintf(sNonce, sizeof(sNonce), "%020llu", (uint64_t)0);
        assert(written == 20);
        o->Set(NanNew<String>("nonce"), NanNew<String>(sNonce));
      }
    } else if (strCommand == "pong") {
      int64_t pingUsecEnd = nTimeReceived;
      uint64_t nonce = 0;
      size_t nAvail = vRecv.in_avail();
      bool bPingFinished = false;
      std::string sProblem;

      if (nAvail >= sizeof(nonce)) {
        vRecv >> nonce;

        // Only process pong message if there is an outstanding ping (old ping without nonce should never pong)
        if (pfrom->nPingNonceSent != 0) {
          if (nonce == pfrom->nPingNonceSent) {
            // Matching pong received, this ping is no longer outstanding
            bPingFinished = true;
            int64_t pingUsecTime = pingUsecEnd - pfrom->nPingUsecStart;
            if (pingUsecTime > 0) {
              // Successful ping time measurement, replace previous
              ;
            } else {
              // This should never happen
              sProblem = "Timing mishap";
            }
          } else {
            // Nonce mismatches are normal when pings are overlapping
            sProblem = "Nonce mismatch";
            if (nonce == 0) {
              // This is most likely a bug in another implementation somewhere, cancel this ping
              bPingFinished = true;
              sProblem = "Nonce zero";
            }
          }
        } else {
          sProblem = "Unsolicited pong without ping";
        }
      } else {
        // This is most likely a bug in another implementation somewhere, cancel this ping
        bPingFinished = true;
        sProblem = "Short payload";
      }

      char sNonce[21] = {0};
      int written = snprintf(sNonce, sizeof(sNonce), "%020llu", (uint64_t)nonce);
      assert(written == 20);

      char sPingNonceSent[21] = {0};
      written = snprintf(sPingNonceSent, sizeof(sPingNonceSent), "%020llu", (uint64_t)pfrom->nPingNonceSent);
      assert(written == 20);

      o->Set(NanNew<String>("expected"), NanNew<String>(sPingNonceSent));
      o->Set(NanNew<String>("received"), NanNew<String>(sNonce));
      o->Set(NanNew<String>("bytes"), NanNew<Number>((unsigned int)nAvail));

      if (!(sProblem.empty())) {
        o->Set(NanNew<String>("problem"), NanNew<String>(sProblem));
      }

      if (bPingFinished) {
        o->Set(NanNew<String>("finished"), NanNew<Boolean>(true));
      } else {
        o->Set(NanNew<String>("finished"), NanNew<Boolean>(false));
      }
    } else if (strCommand == "alert") {
      CAlert alert;
      vRecv >> alert;

      uint256 alertHash = alert.GetHash();

      o->Set(NanNew<String>("hash"), NanNew<String>(alertHash.GetHex()));

      if (pfrom->setKnown.count(alertHash) == 0) {
        if (alert.ProcessAlert()) {
          std::string vchMsg(alert.vchMsg.begin(), alert.vchMsg.end());
          std::string vchSig(alert.vchSig.begin(), alert.vchSig.end());
          o->Set(NanNew<String>("message"), NanNew<String>(vchMsg));
          o->Set(NanNew<String>("signature"), NanNew<String>(vchSig));
          o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(false));
        } else {
          // Small DoS penalty so peers that send us lots of
          // duplicate/expired/invalid-signature/whatever alerts
          // eventually get banned.
          // This isn't a Misbehaving(100) (immediate ban) because the
          // peer might be an older or different implementation with
          // a different signature key, etc.
          o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(true));
        }
      }
    } else if (strCommand == "filterload") {
      CBloomFilter filter;
      vRecv >> filter;

      if (!filter.IsWithinSizeConstraints()) {
        // There is no excuse for sending a too-large filter
        o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(true));
      } else {
        LOCK(pfrom->cs_filter);
        filter.UpdateEmptyFull();

        o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(false));
      }
    } else if (strCommand == "filteradd") {
      vector<unsigned char> vData;
      vRecv >> vData;

      // Nodes must NEVER send a data item > 520 bytes (the max size for a script data object,
      // and thus, the maximum size any matched object can have) in a filteradd message
      if (vData.size() > MAX_SCRIPT_ELEMENT_SIZE) {
        o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(true));
      } else {
        LOCK(pfrom->cs_filter);
        if (pfrom->pfilter) {
          o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(false));
        } else {
          o->Set(NanNew<String>("misbehaving"), NanNew<Boolean>(true));
        }
      }
    } else if (strCommand == "filterclear") {
      ; // nothing much to grab from this packet
    } else if (strCommand == "reject") {
      ; // nothing much to grab from this packet
    } else {
      o->Set(NanNew<String>("unknown"), NanNew<Boolean>(true));
    }

    // Update the last seen time for this node's address
    if (pfrom->fNetworkNode) {
      if (strCommand == "version"
          || strCommand == "addr"
          || strCommand == "inv"
          || strCommand == "getdata"
          || strCommand == "ping") {
        o->Set(NanNew<String>("connected"), NanNew<Boolean>(true));
      }
    }

    obj->Set(i, o);
    i++;

    if (cur == packets_queue_head) {
      packets_queue_head = NULL;
    }

    if (cur == packets_queue_tail) {
      packets_queue_tail = NULL;
    }

    next = cur->next;
    free(cur->strCommand);
    delete cur->vRecv;
    free(cur);
  }

  poll_packets_mutex.unlock();

  NanReturnValue(obj);
}

static void
hook_packets(void) {
  CNodeSignals& nodeSignals = GetNodeSignals();
  nodeSignals.ProcessMessages.connect(&process_packets);
}

static void
unhook_packets(void) {
  CNodeSignals& nodeSignals = GetNodeSignals();
  nodeSignals.ProcessMessages.disconnect(&process_packets);
}

static bool
process_packets(CNode* pfrom) {
  bool fOk = true;

  std::deque<CNetMessage>::iterator it = pfrom->vRecvMsg.begin();
  while (!pfrom->fDisconnect && it != pfrom->vRecvMsg.end()) {
    // Don't bother if send buffer is too full to respond anyway
    if (pfrom->nSendSize >= SendBufferSize()) {
      break;
    }

    // get next message
    CNetMessage& msg = *it;

    // end, if an incomplete message is found
    if (!msg.complete()) {
      break;
    }

    // at this point, any failure means we can delete the current message
    it++;

    // Scan for message start
    if (memcmp(msg.hdr.pchMessageStart,
        Params().MessageStart(), MESSAGE_START_SIZE) != 0) {
      fOk = false;
      break;
    }

    // Read header
    CMessageHeader& hdr = msg.hdr;
    if (!hdr.IsValid()) {
      continue;
    }
    string strCommand = hdr.GetCommand();

    // Message size
    unsigned int nMessageSize = hdr.nMessageSize;

    // Checksum
    CDataStream& vRecv = msg.vRecv;
    uint256 hash = Hash(vRecv.begin(), vRecv.begin() + nMessageSize);
    unsigned int nChecksum = 0;
    memcpy(&nChecksum, &hash, sizeof(nChecksum));
    if (nChecksum != hdr.nChecksum) {
      continue;
    }

    // Process message
    process_packet(pfrom, strCommand, vRecv, msg.nTime);
    boost::this_thread::interruption_point();

    break;
  }

  return fOk;
}

static bool
process_packet(CNode* pfrom, string strCommand, CDataStream& vRecv, int64_t nTimeReceived) {
  poll_packets_mutex.lock();

  poll_packets_list *cur = (poll_packets_list *)malloc(sizeof(poll_packets_list));
  if (!packets_queue_head) {
    packets_queue_head = cur;
    packets_queue_tail = cur;
  } else {
    packets_queue_tail->next = cur;
    packets_queue_tail = cur;
  }

  cur->pfrom = pfrom;
  // NOTE: Copy the data stream.
  CDataStream *vRecv_ = new CDataStream(vRecv.begin(), vRecv.end(), vRecv.GetType(), vRecv.GetVersion());
  cur->vRecv = vRecv_;
  cur->nTimeReceived = nTimeReceived;
  cur->strCommand = strdup(strCommand.c_str());
  cur->next = NULL;

  poll_packets_mutex.unlock();

  return true;
}

/**
 * Conversions
 *   cblock_to_jsblock(cblock, cblock_index, jsblock, is_new)
 *   ctx_to_jstx(ctx, blockhash, jstx)
 *   jsblock_to_cblock(jsblock, cblock)
 *   jstx_to_ctx(jstx, ctx)
 * These functions, only callable from C++, are used to convert javascript
 * blocks and tx objects to bitcoin block and tx objects (CBlocks and
 * CTransactions), and vice versa.
 */

// XXX Potentially add entire function's code. If there's a race
// condition, the duplicate check will handle it.
CBlockIndex *
find_new_block_index(uint256 hash, uint256 hashPrevBlock, bool *is_allocated) {
  // Check for duplicate
  BlockMap::iterator it = mapBlockIndex.find(hash);
  if (it != mapBlockIndex.end()) {
    return it->second;
  }

  // Construct new block index object
  CBlockIndex* pindexNew = new CBlockIndex();
  assert(pindexNew);
  BlockMap::iterator miPrev = mapBlockIndex.find(hashPrevBlock);
  if (miPrev != mapBlockIndex.end()) {
    pindexNew->pprev = (*miPrev).second;
    pindexNew->nHeight = pindexNew->pprev->nHeight + 1;
  }

  *is_allocated = true;

  return pindexNew;
}

static inline void
cblock_to_jsblock(const CBlock& cblock, CBlockIndex* cblock_index, Local<Object> jsblock, bool is_new) {
  bool is_allocated = false;

  if (!cblock_index && is_new) {
    cblock_index = find_new_block_index(cblock.GetHash(), cblock.hashPrevBlock, &is_allocated);
  }

  uint256 blockhash = cblock.GetHash();

  jsblock->Set(NanNew<String>("hash"), NanNew<String>(blockhash.GetHex()));
  CMerkleTx txGen(cblock.vtx[0]);
  txGen.SetMerkleBranch(cblock);
  jsblock->Set(NanNew<String>("confirmations"), NanNew<Number>((int)txGen.GetDepthInMainChain())->ToInt32());
  jsblock->Set(NanNew<String>("size"),
    NanNew<Number>((int)::GetSerializeSize(cblock, SER_NETWORK, PROTOCOL_VERSION))->ToInt32());

  if (cblock_index) {
    jsblock->Set(NanNew<String>("height"), NanNew<Number>(cblock_index->nHeight));
  }

  //
  // Headers
  //
  jsblock->Set(NanNew<String>("version"), NanNew<Number>((int32_t)cblock.nVersion));
  jsblock->Set(NanNew<String>("previousblockhash"), NanNew<String>((std::string)cblock.hashPrevBlock.ToString()));
  jsblock->Set(NanNew<String>("merkleroot"), NanNew<String>((std::string)cblock.hashMerkleRoot.GetHex()));
  jsblock->Set(NanNew<String>("time"), NanNew<Number>((uint32_t)cblock.GetBlockTime())->ToUint32());
  jsblock->Set(NanNew<String>("bits"), NanNew<Number>((uint32_t)cblock.nBits)->ToUint32());
  jsblock->Set(NanNew<String>("nonce"), NanNew<Number>((uint32_t)cblock.nNonce)->ToUint32());

  if (cblock_index) {
    jsblock->Set(NanNew<String>("difficulty"), NanNew<Number>(GetDifficulty(cblock_index)));
    jsblock->Set(NanNew<String>("chainwork"), NanNew<String>(cblock_index->nChainWork.GetHex()));
  }

  if (cblock_index) {
    CBlockIndex *pnext = chainActive.Next(cblock_index);
    if (pnext) {
      jsblock->Set(NanNew<String>("nextblockhash"), NanNew<String>(pnext->GetBlockHash().GetHex()));
    }
  }

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
    ctx_to_jstx(ctx, blockhash, jstx);
    txs->Set(ti, jstx);
    ti++;
  }
  jsblock->Set(NanNew<String>("tx"), txs);

  CDataStream ssBlock(SER_NETWORK, PROTOCOL_VERSION);
  ssBlock << cblock;
  std::string strHex = HexStr(ssBlock.begin(), ssBlock.end());
  jsblock->Set(NanNew<String>("hex"), NanNew<String>(strHex));

  // Was it allocated in find_new_block_index(), or did it already exist?
  // (race condition here)
  if (is_allocated) {
    delete cblock_index;
  }
}

static int
get_tx(uint256 txid, uint256& blockhash, CTransaction& ctx) {
  if (GetTransaction(txid, ctx, blockhash, true)) {
    return 1;
  } else if (blockhash != 0) {
    CBlock block;
    CBlockIndex* pblockindex = mapBlockIndex[blockhash];
    if (ReadBlockFromDisk(block, pblockindex)) {
      BOOST_FOREACH(const CTransaction& tx, block.vtx) {
        if (tx.GetHash() == txid) {
          ctx = tx;
          blockhash = block.GetHash();
          return -1;
        }
      }
    }
  }
  return 0;
}

static inline void
ctx_to_jstx(const CTransaction& ctx, uint256 blockhash, Local<Object> jstx) {
  // Find block hash if it's in our wallet
  bool is_mine = false;
  CWalletTx cwtx;

  jstx->Set(NanNew<String>("current_version"),
    NanNew<Number>((int)ctx.CURRENT_VERSION)->ToInt32());

  jstx->Set(NanNew<String>("txid"), NanNew<String>(ctx.GetHash().GetHex()));
  jstx->Set(NanNew<String>("version"),
    NanNew<Number>((int)ctx.nVersion)->ToInt32());
  jstx->Set(NanNew<String>("locktime"),
    NanNew<Number>((unsigned int)ctx.nLockTime)->ToUint32());

  jstx->Set(NanNew<String>("size"),
    NanNew<Number>((int)::GetSerializeSize(ctx, SER_NETWORK, PROTOCOL_VERSION))->ToInt32());

  Local<Array> vin = NanNew<Array>();
  int vi = 0;
  BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
    Local<Object> in = NanNew<Object>();

    if (ctx.IsCoinBase()) {
      in->Set(NanNew<String>("coinbase"),
        NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));
    }

    in->Set(NanNew<String>("txid"), NanNew<String>(txin.prevout.hash.GetHex()));
    in->Set(NanNew<String>("vout"),
      NanNew<Number>((unsigned int)txin.prevout.n)->ToUint32());

    Local<Object> o = NanNew<Object>();
    o->Set(NanNew<String>("asm"),
      NanNew<String>(txin.scriptSig.ToString()));
    o->Set(NanNew<String>("hex"),
      NanNew<String>(HexStr(txin.scriptSig.begin(), txin.scriptSig.end())));

    Local<Object> jsprev = NanNew<Object>();
    CTransaction prev_tx;
    if (get_tx(txin.prevout.hash, blockhash, prev_tx)) {
      CTxDestination from;
      CTxOut prev_out = prev_tx.vout[txin.prevout.n];
      ExtractDestination(prev_out.scriptPubKey, from);
      CBitcoinAddress addrFrom(from);
      jsprev->Set(NanNew<String>("address"),
        NanNew<String>(addrFrom.ToString()));
      jsprev->Set(NanNew<String>("value"),
        NanNew<Number>((int64_t)prev_out.nValue)->ToInteger());
    } else {
      const CTxOut& txout = ctx.vout[0];
      const CScript& scriptPubKey = txout.scriptPubKey;
      txnouttype type;
      vector<CTxDestination> addresses;
      int nRequired;
      if (ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
        // Unknowns usually have the same first addr as the first output:
        // https://blockexplorer.com/testnet/block/
        const CTxDestination& addr = addresses[0];
        jsprev->Set(NanNew<String>("address"),
          NanNew<String>(CBitcoinAddress(addr).ToString() + std::string("?")));
        jsprev->Set(NanNew<String>("value"),
          NanNew<Number>((int64_t)txout.nValue)->ToInteger());
      } else {
        jsprev->Set(NanNew<String>("address"),
          NanNew<String>(std::string("Unknown")));
        jsprev->Set(NanNew<String>("value"), NanNew<Number>(0));
      }
    }
    in->Set(NanNew<String>("prev"), jsprev);

    in->Set(NanNew<String>("scriptSig"), o);

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
      out->Set(NanNew<String>("hex"),
        NanNew<String>(HexStr(scriptPubKey.begin(), scriptPubKey.end())));
      if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
        out->Set(NanNew<String>("type"),
          NanNew<String>(GetTxnOutputType(type)));
      } else {
        out->Set(NanNew<String>("reqSigs"),
          NanNew<Number>((int)nRequired)->ToInt32());
        out->Set(NanNew<String>("type"),
          NanNew<String>(GetTxnOutputType(type)));
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

  jstx->Set(NanNew<String>("ismine"), NanNew<Boolean>(is_mine));

  if (blockhash != 0) {
    jstx->Set(NanNew<String>("blockhash"), NanNew<String>(blockhash.GetHex()));
    if (ctx.IsCoinBase()) {
      jstx->Set(NanNew<String>("generated"), NanNew<Boolean>(true));
    }
    if (mapBlockIndex.count(blockhash) > 0) {
      CBlockIndex* pindex = mapBlockIndex[blockhash];
      jstx->Set(NanNew<String>("confirmations"),
        NanNew<Number>(pindex->nHeight));
      // XXX Not really index:
      jstx->Set(NanNew<String>("blockindex"),
        NanNew<Number>(pindex->nHeight));
      jstx->Set(NanNew<String>("blockheight"),
        NanNew<Number>(pindex->nHeight));
      jstx->Set(NanNew<String>("blocktime"),
        NanNew<Number>((int64_t)pindex->GetBlockTime())->ToInteger());
      jstx->Set(NanNew<String>("time"),
        NanNew<Number>((int64_t)pindex->GetBlockTime())->ToInteger());
      jstx->Set(NanNew<String>("timereceived"),
        NanNew<Number>((int64_t)pindex->GetBlockTime())->ToInteger());
    } else {
      jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(0));
      // XXX Not really index:
      jstx->Set(NanNew<String>("blockindex"), NanNew<Number>(-1));
      jstx->Set(NanNew<String>("blockheight"), NanNew<Number>(-1));
      jstx->Set(NanNew<String>("blocktime"), NanNew<Number>(0));
      jstx->Set(NanNew<String>("time"), NanNew<Number>(0));
      jstx->Set(NanNew<String>("timereceived"), NanNew<Number>(0));
    }
    if (!is_mine) {
      jstx->Set(NanNew<String>("walletconflicts"), NanNew<Array>());
    } else {
      // XXX If the tx is ours
      int confirms = cwtx.GetDepthInMainChain();
      jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(confirms));
      Local<Array> conflicts = NanNew<Array>();
      int co = 0;
      BOOST_FOREACH(const uint256& conflict, cwtx.GetConflicts()) {
        conflicts->Set(co++, NanNew<String>(conflict.GetHex()));
      }
      jstx->Set(NanNew<String>("walletconflicts"), conflicts);
      jstx->Set(NanNew<String>("time"), NanNew<Number>(cwtx.GetTxTime()));
      jstx->Set(NanNew<String>("timereceived"),
        NanNew<Number>((int64_t)cwtx.nTimeReceived));
    }
  } else {
    jstx->Set(NanNew<String>("blockhash"), NanNew<String>(uint256(0).GetHex()));
    jstx->Set(NanNew<String>("generated"), NanNew<Boolean>(false));
    jstx->Set(NanNew<String>("confirmations"), NanNew<Number>(-1));
    // XXX Not really index:
    jstx->Set(NanNew<String>("blockindex"), NanNew<Number>(-1));
    jstx->Set(NanNew<String>("blockheight"), NanNew<Number>(-1));
    jstx->Set(NanNew<String>("blocktime"), NanNew<Number>(0));
    jstx->Set(NanNew<String>("walletconflicts"), NanNew<Array>());
    jstx->Set(NanNew<String>("time"), NanNew<Number>(0));
    jstx->Set(NanNew<String>("timereceived"), NanNew<Number>(0));
  }

  CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
  ssTx << ctx;
  std::string strHex = HexStr(ssTx.begin(), ssTx.end());
  jstx->Set(NanNew<String>("hex"), NanNew<String>(strHex));
}

static inline void
jsblock_to_cblock(const Local<Object> jsblock, CBlock& cblock) {
  cblock.nVersion = (int32_t)jsblock->Get(NanNew<String>("version"))->Int32Value();

  if (jsblock->Get(NanNew<String>("previousblockhash"))->IsString()) {
    String::Utf8Value hash__(jsblock->Get(NanNew<String>("previousblockhash"))->ToString());
    std::string hash_ = *hash__;
    uint256 hash(hash_);
    cblock.hashPrevBlock = (uint256)hash;
  } else {
    // genesis block
    cblock.hashPrevBlock = (uint256)uint256(0);
  }

  String::Utf8Value mhash__(jsblock->Get(NanNew<String>("merkleroot"))->ToString());
  std::string mhash_ = *mhash__;
  uint256 mhash(mhash_);
  cblock.hashMerkleRoot = (uint256)mhash;

  cblock.nTime = (uint32_t)jsblock->Get(NanNew<String>("time"))->Uint32Value();
  cblock.nBits = (uint32_t)jsblock->Get(NanNew<String>("bits"))->Uint32Value();
  cblock.nNonce = (uint32_t)jsblock->Get(NanNew<String>("nonce"))->Uint32Value();

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
  String::Utf8Value hex_string_(jstx->Get(NanNew<String>("hex"))->ToString());
  std::string hex_string = *hex_string_;

  CDataStream ssData(ParseHex(hex_string), SER_NETWORK, PROTOCOL_VERSION);
  try {
    ssData >> ctx_;
  } catch (std::exception &e) {
    NanThrowError("Bad TX decode");
    return;
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

    String::Utf8Value phash__(in->Get(NanNew<String>("txid"))->ToString());
    std::string phash_ = *phash__;
    uint256 phash(phash_);

    txin.prevout.hash = phash;
    txin.prevout.n = (unsigned int)in->Get(NanNew<String>("vout"))->Uint32Value();

    std::string shash_;
    Local<Object> script_obj = Local<Object>::Cast(in->Get(NanNew<String>("scriptSig")));
    String::Utf8Value shash__(script_obj->Get(NanNew<String>("hex"))->ToString());
    shash_ = *shash__;

    std::vector<unsigned char> shash(shash_.begin(), shash_.end());
    CScript scriptSig(shash.begin(), shash.end());

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
    String::Utf8Value phash__(script_obj->Get(NanNew<String>("hex")));
    std::string phash_ = *phash__;

    std::vector<unsigned char> phash(phash_.begin(), phash_.end());
    CScript scriptPubKey(phash.begin(), phash.end());

    txout.scriptPubKey = scriptPubKey;

    ctx.vout.push_back(txout);
  }

  ctx.nLockTime = (unsigned int)jstx->Get(NanNew<String>("locktime"))->Uint32Value();
}

#if USE_LDB_ADDR

/**
 LevelDB Parser
 DB: blocks/blk/revXXXXX.dat
 */

static ctx_list *
read_addr(const std::string addr, const int64_t blockheight, const int64_t blocktime) {
  ctx_list *head = new ctx_list();
  ctx_list *cur = NULL;

  head->err_msg = std::string("");

  CScript expectedScriptSig = GetScriptForDestination(CBitcoinAddress(addr).Get());

  leveldb::Iterator* pcursor = pblocktree->pdb->NewIterator(pblocktree->iteroptions);

  pcursor->SeekToFirst();

  while (pcursor->Valid()) {
    boost::this_thread::interruption_point();
    try {
      leveldb::Slice slKey = pcursor->key();

      CDataStream ssKey(slKey.data(), slKey.data() + slKey.size(), SER_DISK, CLIENT_VERSION);

      char type;
      ssKey >> type;

      // Blockchain Index Structure:
      // http://bitcoin.stackexchange.com/questions/28168

      // File info record structure
      // 'f' + 4-byte file number
      //   Number of blocks stored in block file
      //   Size of block file: blocks/blkXXXXX.dat
      //   Size of undo file: blocks/revXXXXX.dat
      //   Low and high heights of blocks stored in file
      //   Low and high timestamps of blocks stored in file
      if (type == 'f') {
        goto next;
      }

      // Last block file number used structure
      // 'l'
      //   4-byte file number
      if (type == 'l') {
        goto next;
      }

      // Reindexing structure
      // 'R'
      //   1-byte Boolean (1 if reindexing)
      if (type == 'R') {
        goto next;
      }

      // Flags structure
      // 'F' + 1-byte flag name + flag name string
      //   1-byte Boolean (key may be `txindex` if transaction index is enabled)
      if (type == 'F') {
        goto next;
      }

      // Block Structure:
      // 'b' + 32-byte block hash
      //   The block header
      //   The block height
      //   The number of transactions
      //   The block validation state
      //   The block file and pos
      //   The undo file and pos
      if (type == 'b') {
        leveldb::Slice slValue = pcursor->value();

        CDataStream ssValue(slValue.data(), slValue.data() + slValue.size(), SER_DISK, CLIENT_VERSION);

        uint256 blockhash;
        ssKey >> blockhash;

        // class CBlockIndex {
        //   const uint256* phashBlock;
        //   CBlockIndex* pprev;
        //   CBlockIndex* pskip;
        //   int nHeight;
        //   int nFile;
        //   unsigned int nDataPos;
        //   unsigned int nUndoPos;
        //   uint256 nChainWork;
        //   unsigned int nTx;
        //   unsigned int nChainTx;
        //   unsigned int nStatus;
        //   int nVersion;
        //   uint256 hashMerkleRoot;
        //   unsigned int nTime;
        //   unsigned int nBits;
        //   unsigned int nNonce;
        //   uint32_t nSequenceId;
        // };
        // class CDiskBlockIndex : public CBlockIndex {
        //   uint256 hashPrev;
        // };

        CDiskBlockIndex index;
        ssValue >> index;

        if (blocktime != -1 && index.GetBlockTime() < blocktime) {
          goto next;
        }

        // struct CDiskBlockPos {
        //   int nFile;
        //   unsigned int nPos;
        // };

        CDiskBlockPos blockPos;
        blockPos.nFile = index.nFile;
        blockPos.nPos = index.nDataPos;

        CBlock cblock;

        if (!ReadBlockFromDisk(cblock, blockPos)) {
          goto next;
        }

        BOOST_FOREACH(const CTransaction& ctx, cblock.vtx) {
          BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
            if (txin.scriptSig.ToString() != expectedScriptSig.ToString()) {
              continue;
            }
            if (cur == NULL) {
              head->ctx = ctx;
              head->blockhash = blockhash;
              head->next = NULL;
              cur = head;
            } else {
              ctx_list *item = new ctx_list();
              item->ctx = ctx;
              item->blockhash = blockhash;
              item->next = NULL;
              cur->next = item;
              cur = item;
            }
            goto next;
          }

          for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
            const CTxOut& txout = ctx.vout[vo];
            const CScript& scriptPubKey = txout.scriptPubKey;
            int nRequired;
            txnouttype type;
            vector<CTxDestination> addresses;
            if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
              continue;
            }
            BOOST_FOREACH(const CTxDestination& address, addresses) {
              if (CBitcoinAddress(address).ToString() != addr) {
                continue;
              }
              if (cur == NULL) {
                head->ctx = ctx;
                head->blockhash = blockhash;
                head->next = NULL;
                cur = head;
              } else {
                ctx_list *item = new ctx_list();
                item->ctx = ctx;
                item->blockhash = blockhash;
                item->next = NULL;
                cur->next = item;
                cur = item;
              }
              goto next;
            }
          }
        }
      }

      // Transaction Structure:
      // 't' + 32-byte tx hash
      //   Which block file the tx is stored in
      //   Which offset in the block file the tx resides
      //   The offset from the top of the block containing the tx
      if (type == 't') {
        leveldb::Slice slValue = pcursor->value();

        CDataStream ssValue(slValue.data(), slValue.data() + slValue.size(), SER_DISK, CLIENT_VERSION);

        uint256 txid;
        ssKey >> txid;

        // struct CDiskBlockPos {
        //   int nFile;
        //   unsigned int nPos;
        // };
        // struct CDiskTxPos : public CDiskBlockPos {
        //   unsigned int nTxOffset;
        // };

        CDiskTxPos txPos;
        ssValue >> txPos;

        CTransaction ctx;
        uint256 blockhash;

        if (!pblocktree->ReadTxIndex(txid, txPos)) {
          goto next;
        }

        CAutoFile file(OpenBlockFile(txPos, true), SER_DISK, CLIENT_VERSION);
        CBlockHeader header;
        try {
          file >> header;
          fseek(file.Get(), txPos.nTxOffset, SEEK_CUR);
          file >> ctx;
        } catch (std::exception &e) {
          goto error;
        }
        if (ctx.GetHash() != txid) {
          goto error;
        }
        blockhash = header.GetHash();

        BOOST_FOREACH(const CTxIn& txin, ctx.vin) {
          if (txin.scriptSig.ToString() != expectedScriptSig.ToString()) {
            continue;
          }
          if (cur == NULL) {
            head->ctx = ctx;
            head->blockhash = blockhash;
            head->next = NULL;
            cur = head;
          } else {
            ctx_list *item = new ctx_list();
            item->ctx = ctx;
            item->blockhash = blockhash;
            item->next = NULL;
            cur->next = item;
            cur = item;
          }
          goto next;
        }

        for (unsigned int vo = 0; vo < ctx.vout.size(); vo++) {
          const CTxOut& txout = ctx.vout[vo];
          const CScript& scriptPubKey = txout.scriptPubKey;
          int nRequired;
          txnouttype type;
          vector<CTxDestination> addresses;
          if (!ExtractDestinations(scriptPubKey, type, addresses, nRequired)) {
            continue;
          }
          BOOST_FOREACH(const CTxDestination& address, addresses) {
            if (CBitcoinAddress(address).ToString() != addr) {
              continue;
            }
            if (cur == NULL) {
              head->ctx = ctx;
              head->blockhash = blockhash;
              head->next = NULL;
              cur = head;
            } else {
              ctx_list *item = new ctx_list();
              item->ctx = ctx;
              item->blockhash = blockhash;
              item->next = NULL;
              cur->next = item;
              cur = item;
            }
            goto next;
          }
        }
      }

next:
      pcursor->Next();
    } catch (std::exception &e) {
      head->err_msg = std::string(e.what()
        + std::string(" : Deserialize error. Key: ")
        + pcursor->key().ToString());
      delete pcursor;
      return head;
    }
  }

  delete pcursor;
  return head;

error:
  head->err_msg = std::string("Deserialize Error.");

  delete pcursor;
  return head;
}
#endif

/**
 LevelDB Parser
 DB: blocks/blk/revXXXXX.dat
 */

#if USE_LDB_TX
static bool
get_block_by_tx(const std::string itxid, CBlock& rcblock, CBlockIndex **rcblock_index, CTransaction& rctx) {
  const char *txkey = std::string(std::string("t") + itxid).c_str();
  std::string slValue;
  //leveldb::Slice slValue;

  pblocktree->pdb->Get(leveldb::ReadOptions(), txkey, &slValue);

  CDataStream ssValue(slValue.begin(), slValue.end(), SER_DISK, CLIENT_VERSION);
  //CDataStream ssValue(slValue.data(), slValue.data() + slValue.size(), SER_DISK, CLIENT_VERSION);

  // Blockchain Index Structure:
  // http://bitcoin.stackexchange.com/questions/28168

  // Transaction Structure:
  // 't' + 32-byte tx hash
  //   Which block file the tx is stored in
  //   Which offset in the block file the tx resides
  //   The offset from the top of the block containing the tx

  // struct CDiskBlockPos {
  //   int nFile;
  //   unsigned int nPos;
  // };
  // struct CDiskTxPos : public CDiskBlockPos {
  //   unsigned int nTxOffset;
  // };

  CDiskTxPos txPos;
  ssValue >> txPos;

  CTransaction ctx;
  uint256 blockhash;

  if (!pblocktree->ReadTxIndex(txid, txPos)) {
    goto error;
  }

  CAutoFile file(OpenBlockFile(txPos, true), SER_DISK, CLIENT_VERSION);
  CBlockHeader header;
  try {
    file >> header;
    fseek(file.Get(), txPos.nTxOffset, SEEK_CUR);
    file >> ctx;
  } catch (std::exception &e) {
    goto error;
  }
  if (ctx.GetHash() != txid) {
    goto error;
  }
  blockhash = header.GetHash();

  CBlockIndex* pblockindex = mapBlockIndex[blockhash];

  if (ReadBlockFromDisk(rcblock, pblockindex)) {
    *rcblock_index = pblockindex;
    rctx = ctx;
    return true;
  }

  return false;
}
#endif

/**
 * Helpers
 */

static bool
set_cooked(void) {
  uv_tty_t tty;
  tty.mode = 1;
  tty.orig_termios = orig_termios;

  if (!uv_tty_set_mode(&tty, 0)) {
    printf("\x1b[H\x1b[J");
    return true;
  }

  return false;
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
  NODE_SET_METHOD(target, "getTransaction", GetTransaction);
  NODE_SET_METHOD(target, "broadcastTx", BroadcastTx);
  NODE_SET_METHOD(target, "verifyBlock", VerifyBlock);
  NODE_SET_METHOD(target, "verifyTransaction", VerifyTransaction);
  NODE_SET_METHOD(target, "getInfo", GetInfo);
  NODE_SET_METHOD(target, "getPeerInfo", GetPeerInfo);
  NODE_SET_METHOD(target, "getAddresses", GetAddresses);
  NODE_SET_METHOD(target, "getProgress", GetProgress);
  NODE_SET_METHOD(target, "getMiningInfo", GetMiningInfo);
  NODE_SET_METHOD(target, "getAddrTransactions", GetAddrTransactions);
  NODE_SET_METHOD(target, "getBestBlock", GetBestBlock);
  NODE_SET_METHOD(target, "getChainHeight", GetChainHeight);
  NODE_SET_METHOD(target, "getBlockByTx", GetBlockByTx);
  NODE_SET_METHOD(target, "getBlocksByTime", GetBlocksByTime);
  NODE_SET_METHOD(target, "getFromTx", GetFromTx);
  NODE_SET_METHOD(target, "getLastFileIndex", GetLastFileIndex);
  NODE_SET_METHOD(target, "getBlockHex", GetBlockHex);
  NODE_SET_METHOD(target, "getTxHex", GetTxHex);
  NODE_SET_METHOD(target, "blockFromHex", BlockFromHex);
  NODE_SET_METHOD(target, "txFromHex", TxFromHex);
  NODE_SET_METHOD(target, "hookPackets", HookPackets);

}

NODE_MODULE(bitcoindjs, init)
