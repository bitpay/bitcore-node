/**
 * bitcoind.js - a binding for node.js which links to libbitcoind.so/dylib.
 * Copyright (c) 2015, BitPay (MIT License)
 *
 * libbitcoind.cc:
 *   A bitcoind node.js binding.
 */

#include "libbitcoind.h"

using namespace std;
using namespace boost;
using namespace node;
using namespace v8;
using Nan::New;
using Nan::Null;
using Nan::Set;
using Nan::ThrowError;
using Nan::GetCurrentContext;
using Nan::GetFunction;
using v8::FunctionTemplate;

/**
 * Bitcoin Globals
 */

// These global functions and variables are
// required to be defined/exposed here.

extern void WaitForShutdown(boost::thread_group* threadGroup);
static termios orig_termios;
extern CTxMemPool mempool;
extern int64_t nTimeBestReceived;

/**
 * Node.js Internal Function Templates
 */

static void
tx_notifier(uv_async_t *handle);

static void
async_tip_update(uv_work_t *req);

static void
async_tip_update_after(uv_work_t *req);

static void
async_start_node(uv_work_t *req);

static void
async_start_node_after(uv_work_t *req);

static void
async_blocks_ready(uv_work_t *req);

static void
async_blocks_ready_after(uv_work_t *req);

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
async_get_tx_and_info(uv_work_t *req);

static void
async_get_tx_and_info_after(uv_work_t *req);

static bool
queueTx(const CTransaction&);

extern "C" void
init(Handle<Object>);

/**
 * Private Global Variables
 * Used only by bitcoind functions.
 */
static std::vector<CTransaction> txQueue;
static uv_async_t txmon_async;
static Eternal<Function> txmon_callback;
static bool txmon_callback_available;

static volatile bool shutdown_complete = false;
static char *g_data_dir = NULL;
static bool g_rpc = false;
static bool g_testnet = false;
static bool g_regtest = false;
static bool g_txindex = false;

static boost::thread_group threadGroup;

/**
 * Private Structs
 * Used for async functions and necessary linked lists at points.
 */

struct async_tip_update_data {
  uv_work_t req;
  size_t result;
  Isolate* isolate;
  Persistent<Function> callback;
};

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_block_ready_data {
  uv_work_t req;
  std::string err_msg;
  std::string result;
  Isolate* isolate;
  Persistent<Function> callback;
};

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_node_data {
  uv_work_t req;
  std::string err_msg;
  std::string result;
  std::string datadir;
  bool rpc;
  bool testnet;
  bool regtest;
  bool txindex;
  Isolate* isolate;
  Persistent<Function> callback;
};

/**
 * async_block_data
 */

struct async_block_data {
  uv_work_t req;
  std::string err_msg;
  std::string hash;
  int64_t height;
  char* buffer;
  uint32_t size;
  CBlock cblock;
  CBlockIndex* cblock_index;
  Isolate* isolate;
  Persistent<Function> callback;
};

/**
 * async_tx_data
 */

struct async_tx_data {
  uv_work_t req;
  std::string err_msg;
  std::string txid;
  std::string blockHash;
  uint32_t nTime;
  int64_t height;
  bool queryMempool;
  CTransaction ctx;
  Isolate* isolate;
  Persistent<Function> callback;
};

/**
 * Helpers
 */

static bool
set_cooked(void);

/**
 * SyncPercentage()
 * bitcoind.syncPercentage()
 * provides a float value >= indicating the progress of the blockchain sync
 */
NAN_METHOD(SyncPercentage) {
  const CChainParams& chainParams = Params();
  float progress = 0;
  progress = Checkpoints::GuessVerificationProgress(chainParams.Checkpoints(), chainActive.Tip());
  info.GetReturnValue().Set(progress * 100);
};

NAN_METHOD(GetTxOutSetInfo) {
  {
    LOCK(cs_main);
    CCoinsStats stats;
    FlushStateToDisk();
    if (pcoinsTip->GetStats(stats)) {
      Local<Object> obj = New<Object>();
      Set(obj, New("height").ToLocalChecked(), New<Number>((int64_t)stats.nHeight));
      Set(obj, New("bestblock").ToLocalChecked(), New(stats.hashBlock.GetHex().c_str()).ToLocalChecked());
      Set(obj, New("transactions").ToLocalChecked(), New<Number>((int64_t)stats.nTransactions));
      Set(obj, New("txouts").ToLocalChecked(), New<Number>((int64_t)stats.nTransactionOutputs));
      Set(obj, New("bytes_serialized").ToLocalChecked(), New<Number>((int64_t)stats.nSerializedSize));
      Set(obj, New("hash_serialized").ToLocalChecked(), New(stats.hashSerialized.GetHex()).ToLocalChecked());
      Set(obj, New("total_amount").ToLocalChecked(), New<Number>(stats.nTotalAmount));
      info.GetReturnValue().Set(obj);
      return;
    }
  }
  info.GetReturnValue().Set(Null());
};

NAN_METHOD(GetBestBlockHash) {
  LOCK(cs_main);
  info.GetReturnValue().Set(New(chainActive.Tip()->GetBlockHash().GetHex()).ToLocalChecked());
}

NAN_METHOD(GetNextBlockHash) {

  if (info.Length() < 1 || !info[0]->IsString()) {
    return ThrowError("Usage: bitcoind.getNextBlockHash(blockhash)");
  }

  CBlockIndex* pblockindex;
  v8::String::Utf8Value param1(info[0]->ToString());
  std::string *hash = new std::string(*param1);
  uint256 shash = uint256S(*hash);
  pblockindex = mapBlockIndex[shash];
  CBlockIndex* pnextblockindex = chainActive.Next(pblockindex);
  if (pnextblockindex) {
    uint256 nexthash = pnextblockindex->GetBlockHash();
    std::string rethash = nexthash.ToString();
    info.GetReturnValue().Set(New(rethash).ToLocalChecked());
  } else {
    info.GetReturnValue().Set(Null());
  }

}

/**
 * IsSynced()
 * bitcoind.isSynced()
 * returns a boolean of bitcoin is fully synced
 */
NAN_METHOD(IsSynced) {
  bool isDownloading = IsInitialBlockDownload();
  info.GetReturnValue().Set(New(!isDownloading));
};

NAN_METHOD(StartTxMon) {
  Isolate* isolate = info.GetIsolate();
  Local<Function> callback = Local<Function>::Cast(info[0]);
  Eternal<Function> cb(isolate, callback);
  txmon_callback = cb;
  txmon_callback_available = true;

  CNodeSignals& nodeSignals = GetNodeSignals();
  nodeSignals.TxToMemPool.connect(&queueTx);

  uv_async_init(uv_default_loop(), &txmon_async, tx_notifier);

  info.GetReturnValue().Set(Null());
};

static void
tx_notifier(uv_async_t *handle) {
  Isolate* isolate = GetCurrentContext()->GetIsolate();
  HandleScope scope(isolate);

  Local<Array> results = Array::New(isolate);
  int arrayIndex = 0;

  LOCK(cs_main);
  BOOST_FOREACH(const CTransaction& tx, txQueue) {

    CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
    ssTx << tx;
    std::string stx = ssTx.str();
    Local<Value> txBuffer = node::Buffer::New(isolate, stx.c_str(), stx.size());

    uint256 hash = tx.GetHash();

    Local<Object> obj = New<Object>();

    Set(obj, New("buffer").ToLocalChecked(), txBuffer);
    Set(obj, New("hash").ToLocalChecked(), New(hash.GetHex()).ToLocalChecked());
    Set(obj, New("mempool").ToLocalChecked(), New<Boolean>(true));

    results->Set(arrayIndex, obj);
    arrayIndex++;
  }

  const unsigned argc = 1;
  Local<Value> argv[argc] = {
    Local<Value>::New(isolate, results)
  };

  Local<Function> cb = txmon_callback.Get(isolate);

  cb->Call(isolate->GetCurrentContext()->Global(), argc, argv);

  txQueue.clear();

}
static bool
queueTx(const CTransaction& tx) {
  LOCK(cs_main);
  txQueue.push_back(tx);
  uv_async_send(&txmon_async);
  return true;
}

/**
 * Functions
 */

NAN_METHOD(OnTipUpdate) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);

  async_tip_update_data *req = new async_tip_update_data();

  Local<Function> callback = Local<Function>::Cast(info[0]);
  req->callback.Reset(isolate, callback);
  req->req.data = req;
  req->isolate = isolate;

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_tip_update,
    (uv_after_work_cb)async_tip_update_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

static void
async_tip_update(uv_work_t *req) {
  async_tip_update_data *data = reinterpret_cast<async_tip_update_data*>(req->data);

  size_t lastHeight = chainActive.Height();

  while(lastHeight == (size_t)chainActive.Height() && !shutdown_complete) {
    usleep(1E6);
  }

  data->result = chainActive.Height();

}

static void
async_tip_update_after(uv_work_t *r) {
  async_tip_update_data *req = reinterpret_cast<async_tip_update_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  TryCatch try_catch;
  Local<Value> result = Undefined(isolate);

  if (!shutdown_complete) {
    result = New<Number>(req->result);
  }
  Local<Value> argv[1] = {
    Local<Value>::New(isolate, result)
  };
  cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  req->callback.Reset();
  delete req;
}

NAN_METHOD(OnBlocksReady) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);

  async_block_ready_data *req = new async_block_ready_data();
  req->err_msg = std::string("");
  req->result = std::string("");
  req->req.data = req;
  req->isolate = isolate;

  Local<Function> callback = Local<Function>::Cast(info[0]);
  req->callback.Reset(isolate, callback);

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_blocks_ready,
    (uv_after_work_cb)async_blocks_ready_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

/**
 * async_start_node()
 * Call start_node() and start all our boost threads.
 */

static void
async_blocks_ready(uv_work_t *req) {
  async_block_ready_data *data = reinterpret_cast<async_block_ready_data*>(req->data);
  data->result = std::string("");

  while(!chainActive.Tip()) {
    usleep(1E6);
  }

  CBlockIndex* tip = chainActive.Tip();
  uint256 tipHash = tip->GetBlockHash();

  // Wait to be able to query for blocks by hash
  while(mapBlockIndex.count(tipHash) == 0) {
    usleep(1E6);
  }

  // Wait for chainActive to be able to get the hash
  // for the genesis block for querying blocks by height
  while(chainActive[0] == NULL) {
    usleep(1E6);
  }

  //If the wallet is enabled, then we should make sure we can load it
#ifdef ENABLE_WALLET
  while(pwalletMain == NULL || RPCIsInWarmup(NULL)) {
    usleep(1E6);
  }
#endif

  // Wait until we can get a lock on cs_main
  // And therefore ready to be able to quickly
  // query for transactions from the mempool.
  LOCK(cs_main);
  {
    return;
  }

}

static void
async_blocks_ready_after(uv_work_t *r) {
  async_block_ready_data* req = reinterpret_cast<async_block_ready_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);

  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {
    Local<Value> argv[2] = {
     v8::Null(isolate),
     Local<Value>::New(isolate, New(req->result).ToLocalChecked())
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  req->callback.Reset();
  delete req;
}

/**
 * StartBitcoind()
 * bitcoind.start(callback)
 * Start the bitcoind node with AppInit2() on a separate thread.
 */
NAN_METHOD(StartBitcoind) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);

  Local<Function> callback;
  std::string datadir = std::string("");
  bool rpc = false;
  bool testnet = false;
  bool regtest = false;
  bool txindex = false;

  if (info.Length() >= 2 && info[0]->IsObject() && info[1]->IsFunction()) {
    Local<Object> options = Local<Object>::Cast(info[0]);
    if (options->Get(New("datadir").ToLocalChecked())->IsString()) {
      String::Utf8Value datadir_(options->Get(New("datadir").ToLocalChecked())->ToString());
      datadir = std::string(*datadir_);
    }
    if (options->Get(New("rpc").ToLocalChecked())->IsBoolean()) {
      rpc = options->Get(New("rpc").ToLocalChecked())->ToBoolean()->IsTrue();
    }
    if (options->Get(New("network").ToLocalChecked())->IsString()) {
      String::Utf8Value network_(options->Get(New("network").ToLocalChecked())->ToString());
      std::string network = std::string(*network_);
      if (network == "testnet") {
          testnet = true;
      } else if (network == "regtest") {
          regtest = true;
      }
    }
    if (options->Get(New("txindex").ToLocalChecked())->IsBoolean()) {
      txindex = options->Get(New("txindex").ToLocalChecked())->ToBoolean()->IsTrue();
    }
    callback = Local<Function>::Cast(info[1]);
  } else if (info.Length() >= 2
             && (info[0]->IsUndefined() || info[0]->IsNull())
             && info[1]->IsFunction()) {
    callback = Local<Function>::Cast(info[1]);
  } else if (info.Length() >= 1 && info[0]->IsFunction()) {
    callback = Local<Function>::Cast(info[0]);
  } else {
    return ThrowError(
      "Usage: bitcoind.start(callback)");
  }

  //
  // Run bitcoind's StartNode() on a separate thread.
  //

  async_node_data *req = new async_node_data();
  req->err_msg = std::string("");
  req->result = std::string("");
  req->datadir = datadir;
  req->rpc = rpc;
  req->testnet = testnet;
  req->regtest = regtest;
  req->txindex = txindex;

  req->isolate = isolate;
  req->callback.Reset(isolate, callback);
  req->req.data = req;

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_start_node,
    (uv_after_work_cb)async_start_node_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

/**
 * async_start_node()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node(uv_work_t *req) {
  async_node_data *data = reinterpret_cast<async_node_data*>(req->data);
  if (data->datadir != "") {
    g_data_dir = (char *)data->datadir.c_str();
  } else {
    g_data_dir = (char *)malloc(sizeof(char) * 512);
    snprintf(g_data_dir, sizeof(char) * 512, "%s/.bitcoind.js", getenv("HOME"));
  }
  g_rpc = (bool)data->rpc;
  g_testnet = (bool)data->testnet;
  g_regtest = (bool)data->regtest;
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
async_start_node_after(uv_work_t *r) {
  async_node_data *req = reinterpret_cast<async_node_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);

  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {
    Local<Value> argv[2] = {
     v8::Null(isolate),
     Local<Value>::New(isolate, New(req->result).ToLocalChecked())
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  req->callback.Reset();
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
  return 0;
}

static void
start_node_thread(void) {
  CScheduler scheduler;

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

  if (g_regtest) {
    argv[argc] = (char *)"-regtest";
    argc++;
  }

  argv[argc] = (char *)"-txindex";
  argc++;

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

    fRet = AppInit2(threadGroup, scheduler);

  } catch (std::exception& e) {
     if (set_cooked()) {
       fprintf(stderr, "bitcoind.js: AppInit2(): std::exception\n");
     }
  } catch (...) {
    if (set_cooked()) {
      fprintf(stderr, "bitcoind.js: AppInit2(): other exception\n");
    }
  }

  if (!fRet)
  {
          threadGroup.interrupt_all();
  } else {
          WaitForShutdown(&threadGroup);
  }
  Shutdown();
  shutdown_complete = true;

}

/**
 * StopBitcoind()
 * bitcoind.stop(callback)
 */

NAN_METHOD(StopBitcoind) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);

  if (info.Length() < 1 || !info[0]->IsFunction()) {
    return ThrowError(
      "Usage: bitcoind.stop(callback)");
  }

  Local<Function> callback = Local<Function>::Cast(info[0]);

  //
  // Run bitcoind's StartShutdown() on a separate thread.
  //

  async_node_data *req = new async_node_data();
  req->err_msg = std::string("");
  req->result = std::string("");
  req->callback.Reset(isolate, callback);
  req->req.data = req;
  req->isolate = isolate;

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_stop_node,
    (uv_after_work_cb)async_stop_node_after);

  assert(status == 0);
  info.GetReturnValue().Set(Null());

}

/**
 * async_stop_node()
 * Call StartShutdown() to join the boost threads, which will call Shutdown()
 * and set shutdown_complete to true to notify the main node.js thread.
 */

static void
async_stop_node(uv_work_t *req) {
  async_node_data *data = reinterpret_cast<async_node_data*>(req->data);

  StartShutdown();

  while(!shutdown_complete) {
    usleep(1E6);
  }
  data->result = std::string("bitcoind shutdown.");
}

/**
 * async_stop_node_after()
 * Execute our callback.
 */

static void
async_stop_node_after(uv_work_t *r) {
  async_node_data* req = reinterpret_cast<async_node_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);

  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {
    Local<Value> argv[2] = {
      Local<Value>::New(isolate, Null()),
      Local<Value>::New(isolate, New(req->result).ToLocalChecked())
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
  req->callback.Reset();
  delete req;
}

/**
 * GetBlock()
 * bitcoind.getBlock([blockhash,blockheight], callback)
 * Read any block from disk asynchronously.
 */

NAN_METHOD(GetBlock) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);
  if (info.Length() < 2
      || (!info[0]->IsString() && !info[0]->IsNumber())
      || !info[1]->IsFunction()) {
    return ThrowError(
      "Usage: bitcoind.getBlock([blockhash,blockheight], callback)");
  }

  async_block_data *req = new async_block_data();

  if (info[0]->IsNumber()) {
    int64_t height = info[0]->IntegerValue();
    req->err_msg = std::string("");
    req->hash = std::string("");
    req->height = height;
  } else {
    String::Utf8Value hash_(info[0]->ToString());
    std::string hash = std::string(*hash_);
    req->err_msg = std::string("");
    req->hash = hash;
    req->height = -1;
  }

  Local<Function> callback = Local<Function>::Cast(info[1]);
  req->req.data = req;
  req->isolate = isolate;
  req->callback.Reset(isolate, callback);

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_get_block,
    (uv_after_work_cb)async_get_block_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

static void
async_get_block(uv_work_t *req) {
  async_block_data* data = reinterpret_cast<async_block_data*>(req->data);

  CBlockIndex* pblockindex;
  uint256 hash = uint256S(data->hash);

  if (data->height != -1) {
    pblockindex = chainActive[data->height];
    if (pblockindex == NULL) {
      data->err_msg = std::string("Block not found.");
      return;
    }
  } else {
    if (mapBlockIndex.count(hash) == 0) {
      data->err_msg = std::string("Block not found.");
      return;
    } else {
      pblockindex = mapBlockIndex[hash];
    }
  }

  const CDiskBlockPos& pos = pblockindex->GetBlockPos();

  // We can read directly from the file, and pass that, we don't need to
  // deserialize the entire block only for it to then be serialized
  // and then deserialized again in JavaScript

  // Open history file to read
  CAutoFile filein(OpenBlockFile(pos, true), SER_DISK, CLIENT_VERSION);
  if (filein.IsNull()) {
    data->err_msg = std::string("ReadBlockFromDisk: OpenBlockFile failed");
    return;
  }

  // Get the actual file, seeked position and rewind a uint32_t
  FILE* blockFile = filein.release();
  long int filePos = ftell(blockFile);
  fseek(blockFile, filePos - sizeof(uint32_t), SEEK_SET);

  // Read the size of the block
  uint32_t size = 0;
  fread(&size, sizeof(uint32_t), 1, blockFile);

  // Read block
  char* buffer = (char *)malloc(sizeof(char) * size);
  fread((void *)buffer, sizeof(char), size, blockFile);
  fclose(blockFile);

  data->buffer = buffer;
  data->size = size;
  data->cblock_index = pblockindex;

}

static void
async_get_block_after(uv_work_t *r) {
  async_block_data* req = reinterpret_cast<async_block_data*>(r->data);
  Isolate *isolate = req->isolate;
  HandleScope scope(isolate);

  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {

    Local<Value> rawNodeBuffer = node::Buffer::New(isolate, req->buffer, req->size);

    delete req->buffer;
    req->buffer = NULL;

    Local<Value> argv[2] = {
      Local<Value>::New(isolate, Null()),
      rawNodeBuffer
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  req->callback.Reset();
  delete req;
}

/**
 * GetTransaction()
 * bitcoind.getTransaction(txid, queryMempool, callback)
 * Read any transaction from disk asynchronously.
 */

NAN_METHOD(GetTransaction) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);
  if (info.Length() < 3
      || !info[0]->IsString()
      || !info[1]->IsBoolean()
      || !info[2]->IsFunction()) {
    return ThrowError(
      "Usage: daemon.getTransaction(txid, queryMempool, callback)");
  }

  String::Utf8Value txid_(info[0]->ToString());
  bool queryMempool = info[1]->BooleanValue();
  Local<Function> callback = Local<Function>::Cast(info[2]);

  async_tx_data *req = new async_tx_data();

  req->err_msg = std::string("");
  req->txid = std::string("");

  std::string txid = std::string(*txid_);

  req->txid = txid;
  req->queryMempool = queryMempool;
  req->isolate = isolate;
  req->req.data = req;
  req->callback.Reset(isolate, callback);

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_get_tx,
    (uv_after_work_cb)async_get_tx_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

static void
async_get_tx(uv_work_t *req) {
  async_tx_data* data = reinterpret_cast<async_tx_data*>(req->data);

  uint256 hash = uint256S(data->txid);
  uint256 blockhash;
  CTransaction ctx;

  if (data->queryMempool) {
    LOCK(cs_main);
    {
      if (mempool.lookup(hash, ctx))
      {
        data->ctx = ctx;
        return;
      }
    }
  }

  CDiskTxPos postx;
  if (pblocktree->ReadTxIndex(hash, postx)) {

    CAutoFile file(OpenBlockFile(postx, true), SER_DISK, CLIENT_VERSION);

    if (file.IsNull()) {
      data->err_msg = std::string("%s: OpenBlockFile failed", __func__);
      return;
    }

    const int HEADER_SIZE = sizeof(int32_t) + sizeof(uint32_t) * 3 + sizeof(char) * 64;

    try {
      fseek(file.Get(), postx.nTxOffset + HEADER_SIZE, SEEK_CUR);
      file >> ctx;
      data->ctx = ctx;
    } catch (const std::exception& e) {
      data->err_msg = std::string("Deserialize or I/O error - %s", __func__);
      return;
    }

  }

}

static void
async_get_tx_after(uv_work_t *r) {
  async_tx_data* req = reinterpret_cast<async_tx_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);

  CTransaction ctx = req->ctx;
  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {

    Local<Value> result = Local<Value>::New(isolate, Null());

    if (!ctx.IsNull()) {
      CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
      ssTx << ctx;
      std::string stx = ssTx.str();
      result = node::Buffer::New(isolate, stx.c_str(), stx.size());
    }

    Local<Value> argv[2] = {
      Local<Value>::New(isolate, Null()),
      result
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  req->callback.Reset();
  delete req;
}

/**
 * GetTransactionWithBlockInfo()
 * bitcoind.getTransactionWithBlockInfo(txid, queryMempool, callback)
 * Read any transaction from disk asynchronously with block timestamp and height.
 */

NAN_METHOD(GetTransactionWithBlockInfo) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);
  if (info.Length() < 3
      || !info[0]->IsString()
      || !info[1]->IsBoolean()
      || !info[2]->IsFunction()) {
    return ThrowError(
      "Usage: bitcoind.getTransactionWithBlockInfo(txid, queryMempool, callback)");
  }

  String::Utf8Value txid_(info[0]->ToString());
  bool queryMempool = info[1]->BooleanValue();
  Local<Function> callback = Local<Function>::Cast(info[2]);

  async_tx_data *req = new async_tx_data();

  req->err_msg = std::string("");
  req->txid = std::string("");

  std::string txid = std::string(*txid_);

  req->txid = txid;
  req->queryMempool = queryMempool;
  req->req.data = req;
  req->isolate = isolate;
  req->callback.Reset(isolate, callback);

  int status = uv_queue_work(uv_default_loop(),
    &req->req, async_get_tx_and_info,
    (uv_after_work_cb)async_get_tx_and_info_after);

  assert(status == 0);

  info.GetReturnValue().Set(Null());
}

static void
async_get_tx_and_info(uv_work_t *req) {
  async_tx_data* data = reinterpret_cast<async_tx_data*>(req->data);

  uint256 hash = uint256S(data->txid);
  uint256 blockHash;
  CTransaction ctx;

  if (data->queryMempool) {
    LOCK(mempool.cs);
    map<uint256, CTxMemPoolEntry>::const_iterator i = mempool.mapTx.find(hash);
    if (i != mempool.mapTx.end()) {
      data->ctx = i->second.GetTx();
      data->nTime = i->second.GetTime();
      data->height = -1;
      return;
    }
  }

  CDiskTxPos postx;
  if (pblocktree->ReadTxIndex(hash, postx)) {

    CAutoFile file(OpenBlockFile(postx, true), SER_DISK, CLIENT_VERSION);

    if (file.IsNull()) {
      data->err_msg = std::string("%s: OpenBlockFile failed", __func__);
      return;
    }

    CBlockHeader blockHeader;

    try {
      // Read header first to get block timestamp and hash
      file >> blockHeader;
      blockHash = blockHeader.GetHash();
      data->blockHash = blockHash.GetHex();
      data->nTime = blockHeader.nTime;
      fseek(file.Get(), postx.nTxOffset, SEEK_CUR);
      file >> ctx;
      data->ctx = ctx;
    } catch (const std::exception& e) {
      data->err_msg = std::string("Deserialize or I/O error - %s", __func__);
      return;
    }

    // get block height
    CBlockIndex* blockIndex;

    if (mapBlockIndex.count(blockHash) == 0) {
      data->height = -1;
    } else {
      blockIndex = mapBlockIndex[blockHash];
      data->height = blockIndex->nHeight;
    }

  }

}

static void
async_get_tx_and_info_after(uv_work_t *r) {
  async_tx_data* req = reinterpret_cast<async_tx_data*>(r->data);
  Isolate* isolate = req->isolate;
  HandleScope scope(isolate);

  CTransaction ctx = req->ctx;
  TryCatch try_catch;
  Local<Function> cb = Local<Function>::New(isolate, req->callback);
  Local<Object> obj = New<Object>();

  if (req->err_msg != "") {
    Local<Value> err = Exception::Error(New(req->err_msg).ToLocalChecked());
    Local<Value> argv[1] = { err };
    cb->Call(isolate->GetCurrentContext()->Global(), 1, argv);
  } else {

    CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
    ssTx << ctx;
    std::string stx = ssTx.str();
    Local<Value> rawNodeBuffer = node::Buffer::New(isolate, stx.c_str(), stx.size());

    Set(obj, New("blockHash").ToLocalChecked(), New(req->blockHash).ToLocalChecked());
    Set(obj, New("height").ToLocalChecked(), New<Number>(req->height));
    Set(obj, New("timestamp").ToLocalChecked(), New<Number>(req->nTime));
    Set(obj, New("buffer").ToLocalChecked(), rawNodeBuffer);

    Local<Value> argv[2] = {
      Local<Value>::New(isolate, Null()),
      obj
    };
    cb->Call(isolate->GetCurrentContext()->Global(), 2, argv);
  }
  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
  req->callback.Reset();
  delete req;
}

/**
 * IsSpent()
 * bitcoind.isSpent()
 * Determine if an outpoint is spent
 */
NAN_METHOD(IsSpent) {
  if (info.Length() > 2) {
    return ThrowError(
      "Usage: bitcoind.isSpent(txid, outputIndex)");
  }

  String::Utf8Value arg(info[0]->ToString());
  std::string argStr = std::string(*arg);
  const uint256 txid = uint256S(argStr);
  int outputIndex = info[1]->IntegerValue();

  CCoinsView dummy;
  CCoinsViewCache view(&dummy);

  CCoinsViewMemPool viewMemPool(pcoinsTip, mempool);
  view.SetBackend(viewMemPool);

  if (view.HaveCoins(txid)) {
    const CCoins* coins = view.AccessCoins(txid);
    if (coins && coins->IsAvailable(outputIndex)) {
      info.GetReturnValue().Set(New<Boolean>(false));
      return;
    }
  }
  info.GetReturnValue().Set(New<Boolean>(true));
};

/**
 * GetBlockIndex()
 * bitcoind.getBlockIndex()
 * Get index information about a block by hash including:
 * - the total amount of work (expected number of hashes) in the chain up to
 *   and including this block.
 * - the previous hash of the block
 */
NAN_METHOD(GetBlockIndex) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  CBlockIndex* blockIndex;

  if (info[0]->IsNumber()) {
    int64_t height = info[0]->IntegerValue();
    blockIndex = chainActive[height];

    if (blockIndex == NULL) {
      info.GetReturnValue().Set(Null());
    }

  } else {
    String::Utf8Value hash_(info[0]->ToString());
    std::string hashStr = std::string(*hash_);
    uint256 hash = uint256S(hashStr);
    if (mapBlockIndex.count(hash) == 0) {
      info.GetReturnValue().Set(Null());
    } else {
      blockIndex = mapBlockIndex[hash];
    }
  }

  Local<Object> obj = New<Object>();

  arith_uint256 cw = blockIndex->nChainWork;
  CBlockIndex* prevBlockIndex = blockIndex->pprev;
  if (&prevBlockIndex->phashBlock != 0) {
    const uint256* prevHash = prevBlockIndex->phashBlock;
    Set(obj, New("prevHash").ToLocalChecked(), New(prevHash->GetHex()).ToLocalChecked());
  } else {
    Set(obj, New("prevHash").ToLocalChecked(), Null());
  }

  Set(obj, New("hash").ToLocalChecked(), New(blockIndex->phashBlock->GetHex()).ToLocalChecked());
  Set(obj, New("chainWork").ToLocalChecked(), New(cw.GetHex()).ToLocalChecked());

  Set(obj, New("height").ToLocalChecked(), New<Number>(blockIndex->nHeight));

  info.GetReturnValue().Set(obj);
};


/**
 * IsMainChain()
 * bitcoind.isMainChain()
 *
 * @param {string} - block hash
 * @returns {boolean} - True if the block is in the main chain. False if it is an orphan.
 */
NAN_METHOD(IsMainChain) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  CBlockIndex* blockIndex;

  String::Utf8Value hash_(info[0]->ToString());
  std::string hashStr = std::string(*hash_);
  uint256 hash = uint256S(hashStr);
  if (mapBlockIndex.count(hash) == 0) {
    info.GetReturnValue().Set(Null());
  } else {
    blockIndex = mapBlockIndex[hash];
  }

  if (chainActive.Contains(blockIndex)) {
    info.GetReturnValue().Set(New<Boolean>(true));
  } else {
    info.GetReturnValue().Set(New<Boolean>(false));
  }
}

/**
 * GetInfo()
 * bitcoind.getInfo()
 * Get miscellaneous information
 */

NAN_METHOD(GetInfo) {
  if (info.Length() > 0) {
    return ThrowError(
      "Usage: bitcoind.getInfo()");
  }

  Local<Object> obj = New<Object>();

  proxyType proxy;
  GetProxy(NET_IPV4, proxy);

  Set(obj, New("version").ToLocalChecked(), New<Number>(CLIENT_VERSION));
  Set(obj, New("protocolversion").ToLocalChecked(), New<Number>(PROTOCOL_VERSION));
  Set(obj, New("blocks").ToLocalChecked(), New<Number>((int)chainActive.Height())->ToInt32());
  Set(obj, New("timeoffset").ToLocalChecked(), New<Number>(GetTimeOffset()));
  Set(obj, New("connections").ToLocalChecked(), New<Number>((int)vNodes.size())->ToInt32());
  Set(obj, New("difficulty").ToLocalChecked(), New<Number>((double)GetDifficulty()));
  Set(obj, New("testnet").ToLocalChecked(), New<Boolean>(Params().NetworkIDString() == "test"));
  Set(obj, New("relayfee").ToLocalChecked(), New<Number>(::minRelayTxFee.GetFeePerK())); // double
  Set(obj, New("errors").ToLocalChecked(), New(GetWarnings("statusbar")).ToLocalChecked());

  info.GetReturnValue().Set(obj);
}

/**
 * Estimate Fee
 * @blocks {number} - The number of blocks until confirmed
 */

NAN_METHOD(EstimateFee) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  int nBlocks = info[0]->NumberValue();
  if (nBlocks < 1) {
    nBlocks = 1;
  }

  CFeeRate feeRate = mempool.estimateFee(nBlocks);

  if (feeRate == CFeeRate(0)) {
    info.GetReturnValue().Set(New<Number>(-1.0));
    return;
  }

  CAmount nFee = feeRate.GetFeePerK();

  info.GetReturnValue().Set(New<Number>(nFee));

}

/**
 * Send Transaction
 * bitcoind.sendTransaction()
 * Will add a transaction to the mempool and broadcast to connected peers.
 * @param {string} - The serialized hex string of the transaction.
 * @param {boolean} - Skip absurdly high fee checks
 */
NAN_METHOD(SendTransaction) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  LOCK(cs_main);

  // Decode the transaction
  v8::String::Utf8Value param1(info[0]->ToString());
  std::string *input = new std::string(*param1);
  CTransaction tx;
  if (!DecodeHexTx(tx, *input)) {
    return ThrowError("TX decode failed");
  }
  uint256 hashTx = tx.GetHash();

  // Skip absurdly high fee check
  bool allowAbsurdFees = false;
  if (info.Length() > 1) {
    allowAbsurdFees = info[1]->BooleanValue();
  }

  CCoinsViewCache &view = *pcoinsTip;
  const CCoins* existingCoins = view.AccessCoins(hashTx);
  bool fHaveMempool = mempool.exists(hashTx);
  bool fHaveChain = existingCoins && existingCoins->nHeight < 1000000000;
  if (!fHaveMempool && !fHaveChain) {
    CValidationState state;
    bool fMissingInputs;

    // Attempt to add the transaction to the mempool
    if (!AcceptToMemoryPool(mempool, state, tx, false, &fMissingInputs, !allowAbsurdFees)) {
      if (state.IsInvalid()) {
        return ThrowError((boost::lexical_cast<std::string>(state.GetRejectCode()) + ": " + state.GetRejectReason()).c_str());
      } else {
        if (fMissingInputs) {
          return ThrowError("Missing inputs");
        }
        return ThrowError(state.GetRejectReason().c_str());
      }
    }
  } else if (fHaveChain) {
    return ThrowError("transaction already in block chain");
  }

  // Relay the transaction connect peers
  RelayTransaction(tx);

  info.GetReturnValue().Set(Local<Value>::New(isolate, New(hashTx.GetHex()).ToLocalChecked()));
}

/**
 * GetMempoolTransactions
 * bitcoind.getMempoolTransactions()
 * Will return an array of transaction buffers.
 */
NAN_METHOD(GetMempoolTransactions) {
  Isolate* isolate = info.GetIsolate();
  HandleScope scope(isolate);

  Local<Array> transactions = Array::New(isolate);
  int arrayIndex = 0;

  {
    LOCK(mempool.cs);

    // Iterate through the entire mempool
    std::map<uint256, CTxMemPoolEntry> mapTx = mempool.mapTx;

    for(std::map<uint256, CTxMemPoolEntry>::iterator it = mapTx.begin();
        it != mapTx.end();
        it++) {
      CTxMemPoolEntry entry = it->second;
      const CTransaction tx = entry.GetTx();
      CDataStream dataStreamTx(SER_NETWORK, PROTOCOL_VERSION);
      dataStreamTx << tx;
      std::string txString = dataStreamTx.str();
      Local<Value> txBuffer = node::Buffer::New(isolate, txString.c_str(), txString.size());
      transactions->Set(arrayIndex, txBuffer);
      arrayIndex++;
    }
  }

  info.GetReturnValue().Set(transactions);

}

/**
  * AddMempoolUncheckedTransaction
  */
NAN_METHOD(AddMempoolUncheckedTransaction) {
  v8::String::Utf8Value param1(info[0]->ToString());
  std::string *input = new std::string(*param1);

  CTransaction tx;
  if (!DecodeHexTx(tx, *input)) {
    return ThrowError("could not decode tx");
  }
  bool added = mempool.addUnchecked(tx.GetHash(), CTxMemPoolEntry(tx, 0, 0, 0.0, 1));
  info.GetReturnValue().Set(New<Boolean>(added));

}

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
 * Initialize the singleton object known as bitcoind.
 */

NAN_MODULE_INIT(init) {
  Set(target, New("start").ToLocalChecked(), GetFunction(New<FunctionTemplate>(StartBitcoind)).ToLocalChecked());
  Set(target, New("onBlocksReady").ToLocalChecked(), GetFunction(New<FunctionTemplate>(OnBlocksReady)).ToLocalChecked());
  Set(target, New("onTipUpdate").ToLocalChecked(), GetFunction(New<FunctionTemplate>(OnTipUpdate)).ToLocalChecked());
  Set(target, New("stop").ToLocalChecked(), GetFunction(New<FunctionTemplate>(StopBitcoind)).ToLocalChecked());
  Set(target, New("getBlock").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetBlock)).ToLocalChecked());
  Set(target, New("getTransaction").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetTransaction)).ToLocalChecked());
  Set(target, New("getTransactionWithBlockInfo").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetTransactionWithBlockInfo)).ToLocalChecked());
  Set(target, New("getInfo").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetInfo)).ToLocalChecked());
  Set(target, New("isSpent").ToLocalChecked(), GetFunction(New<FunctionTemplate>(IsSpent)).ToLocalChecked());
  Set(target, New("getBlockIndex").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetBlockIndex)).ToLocalChecked());
  Set(target, New("isMainChain").ToLocalChecked(), GetFunction(New<FunctionTemplate>(IsMainChain)).ToLocalChecked());
  Set(target, New("getMempoolTransactions").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetMempoolTransactions)).ToLocalChecked());
  Set(target, New("addMempoolUncheckedTransaction").ToLocalChecked(), GetFunction(New<FunctionTemplate>(AddMempoolUncheckedTransaction)).ToLocalChecked());
  Set(target, New("sendTransaction").ToLocalChecked(), GetFunction(New<FunctionTemplate>(SendTransaction)).ToLocalChecked());
  Set(target, New("estimateFee").ToLocalChecked(), GetFunction(New<FunctionTemplate>(EstimateFee)).ToLocalChecked());
  Set(target, New("startTxMon").ToLocalChecked(), GetFunction(New<FunctionTemplate>(StartTxMon)).ToLocalChecked());
  Set(target, New("syncPercentage").ToLocalChecked(), GetFunction(New<FunctionTemplate>(SyncPercentage)).ToLocalChecked());
  Set(target, New("isSynced").ToLocalChecked(), GetFunction(New<FunctionTemplate>(IsSynced)).ToLocalChecked());
  Set(target, New("getTxOutSetInfo").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetTxOutSetInfo)).ToLocalChecked());
  Set(target, New("getBestBlockHash").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetBestBlockHash)).ToLocalChecked());
  Set(target, New("getNextBlockHash").ToLocalChecked(), GetFunction(New<FunctionTemplate>(GetNextBlockHash)).ToLocalChecked());
}

NODE_MODULE(libbitcoind, init);
