/**
 * bitcoind.js
 * Copyright (c) 2014, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "nan.h"

/**
 * Bitcoin headers
 */

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

/**
 * Bitcoin Globals
 * Relevant:
 *  ~/bitcoin/src/init.cpp
 *  ~/bitcoin/src/bitcoind.cpp
 *  ~/bitcoin/src/main.h
 */

extern void (ThreadImport)(std::vector<boost::filesystem::path>);
extern void (DetectShutdownThread)(boost::thread_group*);
extern void (StartNode)(boost::thread_group&);
extern int nScriptCheckThreads;
// extern const int DEFAULT_SCRIPTCHECK_THREADS; // static!!
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
async_work(uv_work_t *req);

static void
async_after(uv_work_t *req);

static int
start_node(void);

static unsigned int
parse_logs(char **);

extern "C" void
init(Handle<Object>);

/**
 * async_data
 * Where the uv async request data resides.
 */

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

  // Run on a separate thead:
  // int log_fd = parse_logs(NULL);
  // handle->Set(NanNew<String>("log"), NanNew<Number>(log_fd));

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

/**
 * async_work()
 * Call start_node() and start all our boost threads.
 */

static void
async_work(uv_work_t *req) {
  async_data* data = static_cast<async_data*>(req->data);
  // undefined symbol: _ZTIN5boost6detail16thread_data_baseE
  start_node();
  data->result = (char *)strdup("opened");
}

/**
 * async_after()
 * Execute our callback.
 */

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

/**
 * start_node(void)
 * A reimplementation of AppInit2 minus
 * the logging and argument parsing.
 */

static int
start_node(void) {
  boost::thread_group threadGroup;
  boost::thread *detectShutdownThread = NULL;
  detectShutdownThread = new boost::thread(
    boost::bind(&DetectShutdownThread, &threadGroup));

  for (int i = 0; i < nScriptCheckThreads - 1; i++) {
    threadGroup.create_thread(&ThreadScriptCheck);
  }

  std::vector<boost::filesystem::path> vImportFiles;
  threadGroup.create_thread(boost::bind(&ThreadImport, vImportFiles));

  StartNode(threadGroup);

#ifdef ENABLE_WALLET
  if (pwalletMain) {
    pwalletMain->ReacceptWalletTransactions();
    threadGroup.create_thread(boost::bind(&ThreadFlushWalletDB, boost::ref(pwalletMain->strWalletFile)));
  }
#endif

  return 0;
}

/**
 * parse_logs(log_str)'
 * Flow:
 *   - If bitcoind logs, parse, write to pfd[0].
 *   - If our own logs, write to stdoutd..
 *   TODO: Have this running in a separate thread.
 */

const char bitcoind_char[256] = {
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, /* <- ' ', */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ':', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  'b', 'c', 'd', 0, 0, 0, 0, 'i', 0, 0, 0, 0, 'n', 'o', 0, 0, 0, 0, 't', 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0,
};

static unsigned int
parse_logs(char **log_str) {
  int pfd[2];
  pipe(pfd);
  unsigned int read_fd = pfd[0];
  unsigned int write_fd = pfd[1];
  dup2(write_fd, STDOUT_FILENO);

  int log_pipe[2];
  pipe(log_pipe);
  unsigned int read_log = log_pipe[0];
  unsigned int write_log = log_pipe[1];

  unsigned int rtotal = 0;
  ssize_t r = 0;
  size_t rcount = 80 * sizeof(char);
  char *buf = (char *)malloc(rcount);
  char cur[9];
  unsigned int cp = 0;
  unsigned int reallocs = 0;

  while ((r = read(read_fd, buf + rtotal, rcount))) {
    unsigned int i;
    char *rbuf;

    // Grab the buffer at the start of the bytes that were read:
    rbuf = (char *)(buf + r);

    // If these are our logs, write them to stdout:
    for (i = 0; i < r; i++) {
      // A naive semi-boyer-moore string search (is it a bitcoind: char?):
      unsigned char ch = rbuf[i];
      if (bitcoind_char[ch]) {
        cur[cp] = rbuf[0];
        cp++;
        cur[cp] = '\0';
        if (strcmp(cur, "bitcoind:") == 0) {
          size_t wcount = r;
          ssize_t w = 0;
          ssize_t wtotal = 0;
          // undo redirection
          close(read_fd);
          close(write_fd);
          w = write(STDOUT_FILENO, cur, cp);
          wtotal += w;
          while ((w = write(STDOUT_FILENO, rbuf + i + wtotal, wcount))) {
            if (w == 0 || (size_t)wtotal == rcount) break;
            wtotal += w;
          }
          // reopen redirection
          {
            int pfd[2];
            pipe(pfd);
            read_fd = pfd[0];
            write_fd = pfd[1];
            dup2(write_fd, STDOUT_FILENO);
          }
          break;
        } else if (cp == sizeof cur) {
          cp = 0;
          cur[cp] = '\0';
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
        while ((w = write(write_log, rbuf + i + wtotal + 1, wcount))) {
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

  if (log_str) {
    buf[rtotal] = '\0';
    *log_str = buf;
  } else {
    free(buf);
  }

  return read_log;
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
