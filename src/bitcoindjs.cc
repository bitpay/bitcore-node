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

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem.hpp>
#include <boost/interprocess/sync/file_lock.hpp>
#include <openssl/crypto.h>

#define MIN_CORE_FILEDESCRIPTORS 150

using namespace std;
using namespace boost;

extern void ThreadImport(std::vector<boost::filesystem::path>);
extern void DetectShutdownThread(boost::thread_group*);
extern void StartNode(boost::thread_group&);
extern void ThreadScriptCheck();
extern void StartShutdown();
extern bool ShutdownRequested();
extern bool AppInit2(boost::thread_group&);
extern bool AppInit(int, char**);
extern bool SoftSetBoolArg(const std::string&, bool);
extern void PrintExceptionContinue(std::exception*, const char*);
extern void Shutdown();
extern void noui_connect();
extern int nScriptCheckThreads;
extern bool fDaemon;
extern std::map<std::string, std::string> mapArgs;
#ifdef ENABLE_WALLET
extern std::string strWalletFile;
extern CWallet *pwalletMain;
#endif

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
NAN_METHOD(IsStopping);
NAN_METHOD(IsStopped);
NAN_METHOD(StopBitcoind);
NAN_METHOD(GetBlock);

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

#if OUTPUT_REDIR
static void
open_pipes(int **out_pipe, int **log_pipe);

static void
parse_logs(int **out_pipe, int **log_pipe);

static void
async_parse_logs(uv_work_t *req);

static void
async_parse_logs_after(uv_work_t *req);
#endif

static void
async_get_block(uv_work_t *req);

static void
async_get_block_after(uv_work_t *req);

extern "C" void
init(Handle<Object>);

static volatile bool shutdownComplete = false;

/**
 * async_block_data
 */

struct async_block_data {
  std::string hash;
  std::string err_msg;
  CBlock result_block;
  CBlockIndex* result_blockindex;
  Persistent<Function> callback;
};

/**
 * async_node_data
 * Where the uv async request data resides.
 */

struct async_node_data {
  char *err_msg;
  char *result;
  Persistent<Function> callback;
};

/**
 * async_log_data
 * Where the uv async request data resides.
 */

struct async_log_data {
  int **out_pipe;
  int **log_pipe;
  char *err_msg;
  char *result;
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
  // Setup pipes to differentiate our logs from bitcoind's.
  // Run in a separate thread.
  //

#if OUTPUT_REDIR
  int *out_pipe = (int *)malloc(2 * sizeof(int));
  int *log_pipe = (int *)malloc(2 * sizeof(int));

  open_pipes(&out_pipe, &log_pipe);

  uv_work_t *req_parse_logs = new uv_work_t();
  async_log_data* data_parse_logs = new async_log_data();
  data_parse_logs->out_pipe = &out_pipe;
  data_parse_logs->log_pipe = &log_pipe;
  data_parse_logs->err_msg = NULL;
  data_parse_logs->result = NULL;
  data_parse_logs->callback = Persistent<Function>::New(callback);
  req_parse_logs->data = data_parse_logs;

  int status_parse_logs = uv_queue_work(uv_default_loop(),
    req_parse_logs, async_parse_logs,
    (uv_after_work_cb)async_parse_logs_after);

  assert(status_parse_logs == 0);
#endif

  //
  // Run bitcoind's StartNode() on a separate thread.
  //

  async_node_data *data_start_node = new async_node_data();
  data_start_node->err_msg = NULL;
  data_start_node->result = NULL;
  data_start_node->callback = Persistent<Function>::New(callback);

  uv_work_t *req_start_node = new uv_work_t();
  req_start_node->data = data_start_node;

  int status_start_node = uv_queue_work(uv_default_loop(),
    req_start_node, async_start_node_work,
    (uv_after_work_cb)async_start_node_after);

  assert(status_start_node == 0);

#if OUTPUT_REDIR
  NanReturnValue(NanNew<Number>(log_pipe[1]));
#else
  NanReturnValue(NanNew<Number>(-1));
#endif
}

/**
 * async_start_node_work()
 * Call start_node() and start all our boost threads.
 */

static void
async_start_node_work(uv_work_t *req) {
  async_node_data *node_data = static_cast<async_node_data*>(req->data);
  start_node();
  node_data->result = (char *)strdup("start_node(): bitcoind opened.");
}

/**
 * async_start_node_after()
 * Execute our callback.
 */

static void
async_start_node_after(uv_work_t *req) {
  NanScope();
  async_node_data *node_data = static_cast<async_node_data*>(req->data);

  if (node_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(node_data->err_msg));
    free(node_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(node_data->result))
    };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  // node_data->callback.Dispose();

  if (node_data->result != NULL) {
    free(node_data->result);
  }

  delete node_data;
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

  // horrible fix for a race condition
  sleep(2);
  signal(SIGINT, SIG_DFL);
  signal(SIGHUP, SIG_DFL);

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

#if OUTPUT_REDIR
/**
 * parse_logs(int **out_pipe, int **log_pipe)
 *   Differentiate our logs and bitcoind's logs.
 *   Send bitcoind's logs to a pipe instead.
 */

const char bitcoind_char[256] = {
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, /* <- ' ' */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '.',
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ':', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  'b', 'c', 'd', 0, 0, 0, 0, 'i', 'j', 0, 0, 0, 'n', 'o', 0, 0, 0, 's', 't', 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
};

static void
open_pipes(int **out_pipe, int **log_pipe) {
  pipe(*out_pipe);
  dup2((*out_pipe)[1], STDOUT_FILENO);
  dup2((*out_pipe)[1], STDERR_FILENO);
  pipe(*log_pipe);
}

static void
parse_logs(int **out_pipe, int **log_pipe) {
  unsigned int rtotal = 0;
  ssize_t r = 0;
  size_t rcount = 80 * sizeof(char);
  char *buf = (char *)malloc(rcount);
  char cur[13];
  unsigned int cp = 0;
  unsigned int reallocs = 0;

  while ((r = read((*out_pipe)[0], buf, rcount))) {
    unsigned int i;
    char *rbuf;

    if (r == -1) {
      fprintf(stderr, "bitcoind.js: error=\"parse_logs(): bad read.\"\n");
      sleep(1);
      continue;
    }

    if (r <= 0) continue;

    // Grab the buffer at the start of the bytes that were read:
    rbuf = (char *)(buf + rtotal);

    // If these are our logs, write them to stdout:
    for (i = 0; i < r; i++) {
      // A naive semi-boyer-moore string search (is it a bitcoind: char?):
      unsigned char ch = rbuf[i];
      if (bitcoind_char[ch]) {
        cur[cp] = rbuf[0];
        cp++;
        cur[cp] = '\0';
        if (strcmp(cur, "bitcoind.js:") == 0) {
          size_t wcount = r;
          ssize_t w = 0;
          ssize_t wtotal = 0;
          // undo redirection
          close((*out_pipe)[0]);
          close((*out_pipe)[1]);
          w = write(STDOUT_FILENO, cur, cp);
          wtotal += w;
          while ((w = write(STDOUT_FILENO, rbuf + i + wtotal, wcount))) {
            if (w == -1) {
              fprintf(stderr, "bitcoind.js: error=\"parse_logs(): bad write.\"\n");
              sleep(1);
              break;
            }
            if (w == 0 || (size_t)wtotal == rcount) break;
            wtotal += w;
          }
          // reopen redirection
          pipe(*out_pipe);
          dup2((*out_pipe)[1], STDOUT_FILENO);
          dup2((*out_pipe)[1], STDERR_FILENO);
          break;
        } else if (cp == sizeof cur - 1) {
          cp = 0;
        }
      }
    }

    // If these logs are from bitcoind, write them to the log pipe:
    for (i = 0; i < r; i++) {
      if ((rbuf[i] == '\r' && rbuf[i] == '\n')
          || rbuf[i] == '\r' || rbuf[i] == '\n') {
        size_t wcount = r;
        ssize_t w = 0;
        ssize_t wtotal = 0;
        while ((w = write((*log_pipe)[1], rbuf + i + wtotal + 1, wcount))) {
          if (w == -1) {
            fprintf(stderr, "bitcoind.js: error=\"parse_logs(): bad write.\"\n");
            sleep(1);
            break;
          }
          if (w == 0 || (size_t)wtotal == rcount) break;
          wtotal += w;
        }
      }
    }

    rtotal += r;
    while (rtotal > rcount) {
      reallocs++;
      rcount = (rcount * 2) / reallocs;
      buf = (char *)realloc(buf, rcount);
    }
  }

  free(buf);
}

static void
async_parse_logs(uv_work_t *req) {
  async_log_data *log_data = static_cast<async_log_data*>(req->data);
  parse_logs(log_data->out_pipe, log_data->log_pipe);
  log_data->err_msg = (char *)strdup("parse_logs(): failed.");
}

static void
async_parse_logs_after(uv_work_t *req) {
  NanScope();
  async_log_data *log_data = static_cast<async_log_data*>(req->data);

  if (log_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(log_data->err_msg));
    free(log_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    log_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    assert(0 && "parse_logs(): should never happen.");
  }

  // log_data->callback.Dispose();

  delete log_data;
  delete req;
}
#endif

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

  async_node_data *data_stop_node = new async_node_data();
  data_stop_node->err_msg = NULL;
  data_stop_node->result = NULL;
  data_stop_node->callback = Persistent<Function>::New(callback);

  uv_work_t *req_stop_node = new uv_work_t();
  req_stop_node->data = data_stop_node;

  int status_stop_node = uv_queue_work(uv_default_loop(),
    req_stop_node, async_stop_node_work,
    (uv_after_work_cb)async_stop_node_after);

  assert(status_stop_node == 0);

  NanReturnValue(Undefined());
}

/**
 * async_stop_node_work()
 * Call StartShutdown() to join the boost threads, which will call Shutdown().
 */

static void
async_stop_node_work(uv_work_t *req) {
  async_node_data *node_data = static_cast<async_node_data*>(req->data);
  StartShutdown();
  node_data->result = (char *)strdup("stop_node(): bitcoind shutdown.");
}

/**
 * async_stop_node_after()
 * Execute our callback.
 */

static void
async_stop_node_after(uv_work_t *req) {
  NanScope();
  async_node_data* node_data = static_cast<async_node_data*>(req->data);

  if (node_data->err_msg != NULL) {
    Local<Value> err = Exception::Error(String::New(node_data->err_msg));
    free(node_data->err_msg);
    const unsigned argc = 1;
    Local<Value> argv[argc] = { err };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  } else {
    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(String::New(node_data->result))
    };
    TryCatch try_catch;
    node_data->callback->Call(Context::GetCurrent()->Global(), argc, argv);
    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
  }

  node_data->callback.Dispose();

  if (node_data->result != NULL) {
    free(node_data->result);
  }

  delete node_data;
  delete req;
}

/**
 * GetBlock(hash, callback)
 * bitcoind.getBlock(hash, callback)
 */

NAN_METHOD(GetBlock) {
  NanScope();

  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
        "Usage: bitcoindjs.getBlock(hash, callback)");
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
  CBlock block;
  CBlockIndex* pblockindex = mapBlockIndex[hash];
  if (ReadBlockFromDisk(block, pblockindex)) {
    data->result_block = block;
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
    const CBlock& block = data->result_block;
    const CBlockIndex* blockindex = data->result_blockindex;

    Local<Object> obj = NanNew<Object>();
    obj->Set(NanNew<String>("hash"), NanNew<String>(block.GetHash().GetHex().c_str()));
    CMerkleTx txGen(block.vtx[0]);
    txGen.SetMerkleBranch(&block);
    obj->Set(NanNew<String>("confirmations"), NanNew<Number>((int)txGen.GetDepthInMainChain()));
    obj->Set(NanNew<String>("size"), NanNew<Number>((int)::GetSerializeSize(block, SER_NETWORK, PROTOCOL_VERSION)));
    obj->Set(NanNew<String>("height"), NanNew<Number>(blockindex->nHeight));
    obj->Set(NanNew<String>("version"), NanNew<Number>(block.nVersion));
    obj->Set(NanNew<String>("merkleroot"), NanNew<String>(block.hashMerkleRoot.GetHex()));

    Local<Array> txs = NanNew<Array>();
    int i = 0;
    BOOST_FOREACH(const CTransaction& tx, block.vtx) {
      Local<Object> entry = NanNew<Object>();
      entry->Set(NanNew<String>("txid"), NanNew<String>(tx.GetHash().GetHex()));
      entry->Set(NanNew<String>("version"), NanNew<Number>(tx.nVersion));
      entry->Set(NanNew<String>("locktime"), NanNew<Number>(tx.nLockTime));

      Local<Array> vin = NanNew<Array>();
      int e = 0;
      BOOST_FOREACH(const CTxIn& txin, tx.vin) {
        Local<Object> in = NanNew<Object>();
        if (tx.IsCoinBase()) {
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
        vin->Set(e, in);
      }
      entry->Set(NanNew<String>("vin"), vin);

      Local<Array> vout = NanNew<Array>();
      for (unsigned int j = 0; j < tx.vout.size(); j++) {
        const CTxOut& txout = tx.vout[j];
        Local<Object> out = NanNew<Object>();
        //out->Set(NanNew<String>("value"), NanNew<Number>(ValueFromAmount(txout.nValue)));
        out->Set(NanNew<String>("value"), NanNew<Number>(txout.nValue));
        out->Set(NanNew<String>("n"), NanNew<Number>((boost::int64_t)j));

        // ScriptPubKeyToJSON(txout.scriptPubKey, o, true);
        Local<Object> o = NanNew<Object>();
        {
          const CScript& scriptPubKey = txout.scriptPubKey;
          Local<Object> out = o;
          bool fIncludeHex = true;
          // ---
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
            int k = 0;
            BOOST_FOREACH(const CTxDestination& addr, addresses) {
              a->Set(k, NanNew<String>(CBitcoinAddress(addr).ToString()));
              k++;
            }
            out->Set(NanNew<String>("addresses"), a);
          }
        }
        out->Set(NanNew<String>("scriptPubKey"), o);

        vout->Set(j, out);
      }
      entry->Set(NanNew<String>("vout"), vout);

      // TxToJSON(tx, hashBlock, result);
      {
        const uint256 hashBlock = block.GetHash();
        if (hashBlock != 0) {
          entry->Set(NanNew<String>("blockhash"), NanNew<String>(hashBlock.GetHex()));
          map<uint256, CBlockIndex*>::iterator mi = mapBlockIndex.find(hashBlock);
          if (mi != mapBlockIndex.end() && (*mi).second) {
            CBlockIndex* pindex = (*mi).second;
            if (chainActive.Contains(pindex)) {
              entry->Set(NanNew<String>("confirmations"),
                NanNew<Number>(1 + chainActive.Height() - pindex->nHeight));
              entry->Set(NanNew<String>("time"), NanNew<Number>((boost::int64_t)pindex->nTime));
              entry->Set(NanNew<String>("blocktime"), NanNew<Number>((boost::int64_t)pindex->nTime));
            } else {
              entry->Set(NanNew<String>("confirmations"), NanNew<Number>(0));
            }
          }
        }
      }

      txs->Set(i, entry);
      i++;
    }
    obj->Set(NanNew<String>("tx"), txs);

    obj->Set(NanNew<String>("time"), NanNew<Number>((boost::int64_t)block.GetBlockTime()));
    obj->Set(NanNew<String>("nonce"), NanNew<Number>((boost::uint64_t)block.nNonce));
    obj->Set(NanNew<String>("bits"), NanNew<Number>(block.nBits));
    obj->Set(NanNew<String>("difficulty"), NanNew<Number>(GetDifficulty(blockindex)));
    obj->Set(NanNew<String>("chainwork"), NanNew<String>(blockindex->nChainWork.GetHex()));
    if (blockindex->pprev) {
      obj->Set(NanNew<String>("previousblockhash"), NanNew<String>(blockindex->pprev->GetBlockHash().GetHex()));
    }
    CBlockIndex *pnext = chainActive.Next(blockindex);
    if (pnext) {
      obj->Set(NanNew<String>("nextblockhash"), NanNew<String>(pnext->GetBlockHash().GetHex()));
    }

    const unsigned argc = 2;
    Local<Value> argv[argc] = {
      Local<Value>::New(Null()),
      Local<Value>::New(obj)
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

#if 0
/**
 * GetTx(hash, callback)
 * bitcoind.getTx(hash, callback)
 */

// ~/bitcoin/src/rpcwallet.cpp
// void ListTransactions(const CWalletTx& wtx, const string& strAccount, int nMinDepth, bool fLong, Array& ret)

NAN_METHOD(GetTx) {
  NanScope();

  if (args.Length() < 2
      || !args[0]->IsString()
      || !args[1]->IsFunction()) {
    return NanThrowError(
        "Usage: bitcoindjs.getTx(hash, callback)");
  }

  String::Utf8Value hash(args[0]->ToString());
  Local<Function> callback = Local<Function>::Cast(args[1]);

  Persistent<Function> cb;
  cb = Persistent<Function>::New(callback);

  const CWalletTx& wtx = pwalletMain->mapWallet[hash];

  int64_t nFee;
  string strSentAccount;
  list<pair<CTxDestination, int64_t> > listReceived;
  list<pair<CTxDestination, int64_t> > listSent;

  wtx.GetAmounts(listReceived, listSent, nFee, strSentAccount);

  // Sent
  if (!listSent.empty() || nFee != 0) {
    BOOST_FOREACH(const PAIRTYPE(CTxDestination, int64_t)& s, listSent) {
      Object entry;
      entry.push_back(Pair("account", strSentAccount));
      MaybePushAddress(entry, s.first);
      entry.push_back(Pair("category", "send"));
      entry.push_back(Pair("amount", ValueFromAmount(-s.second)));
      entry.push_back(Pair("fee", ValueFromAmount(-nFee)));
      if (fLong)
          WalletTxToJSON(wtx, entry);
      ret.push_back(entry);
    }
  }

  // Received
  if (listReceived.size() > 0 && wtx.GetDepthInMainChain() >= nMinDepth) {
    BOOST_FOREACH(const PAIRTYPE(CTxDestination, int64_t)& r, listReceived) {
      string account;
      if (pwalletMain->mapAddressBook.count(r.first)) {
        account = pwalletMain->mapAddressBook[r.first].name;
      }
      Object entry;
      entry.push_back(Pair("account", account));
      MaybePushAddress(entry, r.first);
      if (wtx.IsCoinBase()) {
        if (wtx.GetDepthInMainChain() < 1) {
          entry.push_back(Pair("category", "orphan"));
        } else if (wtx.GetBlocksToMaturity() > 0) {
          entry.push_back(Pair("category", "immature"));
        } else {
          entry.push_back(Pair("category", "generate"));
        }
      } else {
        entry.push_back(Pair("category", "receive"));
      }
      entry.push_back(Pair("amount", ValueFromAmount(r.second)));
      if (fLong) {
        WalletTxToJSON(wtx, entry);
      }
      ret.push_back(entry);
    }
  }

  const unsigned argc = 2;
  Local<Value> argv[argc] = {
    Local<Value>::New(Null()),
    Local<Value>::New(obj)
  };
  TryCatch try_catch;
  cb->Call(Context::GetCurrent()->Global(), argc, argv);
  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  cb.Dispose();

  NanReturnValue(Undefined());
}

void WalletTxToJSON(const CWalletTx& wtx, Object& entry) {
  int confirms = wtx.GetDepthInMainChain();
  entry.push_back(Pair("confirmations", confirms));
  if (wtx.IsCoinBase())
      entry.push_back(Pair("generated", true));
  if (confirms > 0)
  {
      entry.push_back(Pair("blockhash", wtx.hashBlock.GetHex()));
      entry.push_back(Pair("blockindex", wtx.nIndex));
      entry.push_back(Pair("blocktime", (boost::int64_t)(mapBlockIndex[wtx.hashBlock]->nTime)));
  }
  uint256 hash = wtx.GetHash();
  entry.push_back(Pair("txid", hash.GetHex()));
  Array conflicts;
  BOOST_FOREACH(const uint256& conflict, wtx.GetConflicts())
      conflicts.push_back(conflict.GetHex());
  entry.push_back(Pair("walletconflicts", conflicts));
  entry.push_back(Pair("time", (boost::int64_t)wtx.GetTxTime()));
  entry.push_back(Pair("timereceived", (boost::int64_t)wtx.nTimeReceived));
  BOOST_FOREACH(const PAIRTYPE(string,string)& item, wtx.mapValue)
      entry.push_back(Pair(item.first, item.second));
}
#endif

#if 0
Reading from disk:
Primary functions:
~/bitcoin/src/serialize.h
  class CAutoFile;
  CAutoFile() - class
~/bitcoin/src/main.cpp
  OpenBlockFile() - function to read block file
  OpenDiskFile() - lowlevel function to open file
  FILE* OpenDiskFile(const CDiskBlockPos &pos, const char *prefix, bool fReadOnly)
  {
    if (pos.IsNull())
      return NULL;
    boost::filesystem::path path = GetDataDir() / "blocks" / strprintf("%s%05u.dat", prefix, pos.nFile);
    boost::filesystem::create_directories(path.parent_path());
    FILE* file = fopen(path.string().c_str(), "rb+");
    if (!file && !fReadOnly)
      file = fopen(path.string().c_str(), "wb+");
    if (!file) {
      LogPrintf("Unable to open file %s\n", path.string());
      return NULL;
    }
    if (pos.nPos) {
      if (fseek(file, pos.nPos, SEEK_SET)) {
        LogPrintf("Unable to seek to position %u of %s\n", pos.nPos, path.string());
        fclose(file);
        return NULL;
      }
    }
    return file;
  }
  FILE* OpenBlockFile(const CDiskBlockPos &pos, bool fReadOnly) {
    return OpenDiskFile(pos, "blk", fReadOnly);
  }
  // main.h:
  //   pindex->GetBlockPos()
  //   In CBlockIndex class:
  //   CDiskBlockPos GetBlockPos() const {
  //     CDiskBlockPos ret;
  //     if (nStatus & BLOCK_HAVE_DATA) {
  //       ret.nFile = nFile;
  //       ret.nPos  = nDataPos;
  //     }
  //     return ret;
  //   }
  // txdb.cpp:
  // bool CBlockTreeDB::LoadBlockIndexGuts()
  // pindexNew->nDataPos = diskindex.nDataPos;
  // CDataStream ssValue(slValue.data(), slValue.data()+slValue.size(), SER_DISK, CLIENT_VERSION);
  // CDiskBlockIndex diskindex;
  // ssValue >> diskindex;
  bool ReadBlockFromDisk(CBlock& block, const CDiskBlockPos& pos) {
    block.SetNull();
    CAutoFile filein = CAutoFile(OpenBlockFile(pos, true), SER_DISK, CLIENT_VERSION);
    // OpenBlockFile(pos, true);
    if (!filein) {
      return error("ReadBlockFromDisk : OpenBlockFile failed");
    }
    // Read block
    try {
      filein >> block;
    } catch (std::exception &e) {
      return error("%s : Deserialize or I/O error - %s", __PRETTY_FUNCTION__, e.what());
    }
  }
  // NEW:
  FILE* OpenTxFile(const CDiskBlockPos &pos, bool fReadOnly) {
    return OpenDiskFile(pos, "tx", fReadOnly);
  }
#endif

#if 0
bool CBlockTreeDB::LoadBlockIndexGuts() {
  leveldb::Iterator *pcursor = NewIterator();

  CDataStream ssKeySet(SER_DISK, CLIENT_VERSION);
  ssKeySet << make_pair('b', uint256(0));
  pcursor->Seek(ssKeySet.str());

  // Load mapBlockIndex
  while (pcursor->Valid()) {
    boost::this_thread::interruption_point();
    try {
      leveldb::Slice slKey = pcursor->key();
      CDataStream ssKey(slKey.data(), slKey.data()+slKey.size(), SER_DISK, CLIENT_VERSION);
      char chType;
      ssKey >> chType;
      if (chType == 'b') {
        leveldb::Slice slValue = pcursor->value();
        CDataStream ssValue(slValue.data(), slValue.data() + slValue.size(), SER_DISK, CLIENT_VERSION);
        CDiskBlockIndex diskindex;
        ssValue >> diskindex;

        // Construct block index object
        CBlockIndex* pindexNew = InsertBlockIndex(diskindex.GetBlockHash());
        pindexNew->pprev          = InsertBlockIndex(diskindex.hashPrev);
        pindexNew->nHeight        = diskindex.nHeight;
        pindexNew->nFile          = diskindex.nFile;
        pindexNew->nDataPos       = diskindex.nDataPos;
        pindexNew->nUndoPos       = diskindex.nUndoPos;
        pindexNew->nVersion       = diskindex.nVersion;
        pindexNew->hashMerkleRoot = diskindex.hashMerkleRoot;
        pindexNew->nTime          = diskindex.nTime;
        pindexNew->nBits          = diskindex.nBits;
        pindexNew->nNonce         = diskindex.nNonce;
        pindexNew->nStatus        = diskindex.nStatus;
        pindexNew->nTx            = diskindex.nTx;

        if (!pindexNew->CheckIndex())
          return error("LoadBlockIndex() : CheckIndex failed: %s", pindexNew->ToString());

        pcursor->Next();
      } else {
        break; // if shutdown requested or finished loading block index
      }
    } catch (std::exception &e) {
        return error("%s : Deserialize or I/O error - %s", __PRETTY_FUNCTION__, e.what());
    }
  }
  delete pcursor;

  return true;
}
#endif

#if 0
static bool
LoadTxs() {
  leveldb::Iterator *pcursor = NewIterator();

  CDataStream ssKeySet(SER_DISK, CLIENT_VERSION);
  ssKeySet << make_pair('t', uint256(0));
  pcursor->Seek(ssKeySet.str());

  // Load mapBlockIndex
  while (pcursor->Valid()) {
    boost::this_thread::interruption_point();
    try {
      leveldb::Slice slKey = pcursor->key();
      CDataStream ssKey(slKey.data(), slKey.data() + slKey.size(), SER_DISK, CLIENT_VERSION);
      char chType;
      ssKey >> chType;
      if (chType == 't') {
        leveldb::Slice slValue = pcursor->value();
        // ~/bitcoin/src/serialize.h :
        CDataStream ssValue(slValue.data(), slValue.data() + slValue.size(), SER_DISK, CLIENT_VERSION);
        // use ssValue to grab tx!
        ssValue.nType
        ssValue.nVersion
        ssValue.nReadPos
        // CDataStream& read(char* pch, int nSize)
        pcursor->Next();
      } else {
        break; // if shutdown requested or finished loading block index
      }
    } catch (std::exception &e) {
        return error("%s : Deserialize or I/O error - %s", __PRETTY_FUNCTION__, e.what());
    }
  }
  delete pcursor;

  return true;
}
#endif

#if 0
// ~/bitcoin/src/txdb.cpp
bool CBlockTreeDB::ReadTxIndex(const uint256 &txid, CDiskTxPos &pos) {
  return Read(make_pair('t', txid), pos);
}
// ~/bitcoin/src/main.h
struct CDiskTxPos : public CDiskBlockPos
// ~/bitcoin/src/main.cpp
// Return transaction in tx, and if it was found inside a block, its hash is placed in hashBlock
bool GetTransaction(const uint256 &hash, CTransaction &txOut, uint256 &hashBlock, bool fAllowSlow)
// ~/bitcoin/src/rpcrawtransaction.cpp
Value getrawtransaction(const Array& params, bool fHelp) {
  uint256 hash = ParseHashV(params[0], "parameter 1");

  bool fVerbose = false;
  if (params.size() > 1)
      fVerbose = (params[1].get_int() != 0);

  CTransaction tx;
  uint256 hashBlock = 0;
  if (!GetTransaction(hash, tx, hashBlock, true))
      throw JSONRPCError(RPC_INVALID_ADDRESS_OR_KEY, "No information available about transaction");

  CDataStream ssTx(SER_NETWORK, PROTOCOL_VERSION);
  ssTx << tx;
  string strHex = HexStr(ssTx.begin(), ssTx.end());

  if (!fVerbose)
      return strHex;

  Object result;
  result.push_back(Pair("hex", strHex));
  TxToJSON(tx, hashBlock, result);
  return result;
}
#endif


/**
 * Init
 */

extern "C" void
init(Handle<Object> target) {
  NanScope();
  NODE_SET_METHOD(target, "start", StartBitcoind);
  NODE_SET_METHOD(target, "stop", StopBitcoind);
  NODE_SET_METHOD(target, "stopping", IsStopping);
  NODE_SET_METHOD(target, "stopped", IsStopped);
  NODE_SET_METHOD(target, "getBlock", GetBlock);
#if 0
  NODE_SET_METHOD(target, "getTx", GetTx);
#endif
}

NODE_MODULE(bitcoindjs, init)
