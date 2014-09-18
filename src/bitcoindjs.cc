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

extern "C" void
init(Handle<Object>);

static volatile bool shutdownComplete = false;

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

  async_node_data* data_start_node = new async_node_data();
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
  async_node_data* node_data = static_cast<async_node_data*>(req->data);
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
 * GetBlock(height)
 * bitcoind.getBlock(height)
 */

NAN_METHOD(GetBlock) {
  NanScope();
  int nHeight = 0;
  CBlockIndex *pindex = chainActive[nHeight];
  CBlock block;
  if (ReadBlockFromDisk(block, pindex)) {
    // const uint256 txhash = 0;
    // uint256 hashBlock = pindex->GetBlockHash();
    // BOOST_FOREACH(const CTransaction &tx, block.vtx) {
    //   if (tx.GetHash() == txhash) {
    //     return true;
    //   }
    // }
    // NanReturnValue(NanNew<String>(""));
  }
  NanReturnValue(NanNew<Boolean>(false));
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
  boost::thread* detectShutdownThread = NULL;

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
  async_log_data* log_data = static_cast<async_log_data*>(req->data);
  parse_logs(log_data->out_pipe, log_data->log_pipe);
  log_data->err_msg = (char *)strdup("parse_logs(): failed.");
}

static void
async_parse_logs_after(uv_work_t *req) {
  NanScope();
  async_log_data* log_data = static_cast<async_log_data*>(req->data);

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

  async_node_data* data_stop_node = new async_node_data();
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
  async_node_data* node_data = static_cast<async_node_data*>(req->data);
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
}

NODE_MODULE(bitcoindjs, init)
