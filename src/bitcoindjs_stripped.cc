/**
 * bitcoind.js - a binding for node.js which links to libbitcoind.so/dylib.
 * Copyright (c) 2015, BitPay (MIT License)
 *
 * bitcoindjs.cc:
 *   A bitcoind node.js binding.
 */

#include "bitcoindjs_stripped.h"

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
  //new boost::thread(boost::bind(&hook_packets));

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
  fprintf(stderr, "Stopping Bitcoind please wait!");
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

}

NODE_MODULE(bitcoindjs, init)
